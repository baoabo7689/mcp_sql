import "dotenv/config";
import sql from "mssql";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

function parseBool(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 1433,
  options: {
    encrypt: parseBool(process.env.SQL_ENCRYPT, false),
    trustServerCertificate: parseBool(process.env.SQL_TRUST_SERVER_CERTIFICATE, true),
  },
  connectionTimeout: process.env.SQL_CONNECTION_TIMEOUT
    ? Number(process.env.SQL_CONNECTION_TIMEOUT)
    : 15000,
  requestTimeout: process.env.SQL_REQUEST_TIMEOUT
    ? Number(process.env.SQL_REQUEST_TIMEOUT)
    : 30000,
};

function validateConfig(config) {
  const required = ["user", "password", "server", "database"];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing SQL config: ${missing.join(", ")}`);
  }
}

function asTextContent(payload) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asErrorContent(error, fallbackMessage) {
  const message = error?.message || fallbackMessage;

  return asTextContent({
    success: false,
    error: message,
  });
}

validateConfig(sqlConfig);

const pool = new sql.ConnectionPool(sqlConfig);
const poolConnection = pool.connect();

const server = new McpServer({
  name: "sql-mcp-server",
  version: "1.0.0",
});

server.tool("list_tables", "List all base tables in the connected database", {}, async () => {
  try {
    const connectedPool = await poolConnection;
    const result = await connectedPool.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);

    return asTextContent({
      success: true,
      count: result.recordset.length,
      tables: result.recordset,
    });
  } catch (error) {
    return asErrorContent(error, "Failed to list tables");
  }
});

server.tool(
  "query_sql",
  "Run a read-only SQL query (SELECT or CTE) against the database",
  {
    sql: z.string().min(1, "sql is required"),
  },
  async ({ sql: queryText }) => {
    try {
      const normalized = queryText.trim().toUpperCase();
      if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
        return asTextContent({
          success: false,
          error: "Only read-only queries are allowed. Use SELECT or WITH.",
        });
      }

      const connectedPool = await poolConnection;
      const result = await connectedPool.request().query(queryText);

      return asTextContent({
        success: true,
        rows: result.recordset,
        rowCount: result.recordset.length,
      });
    } catch (error) {
      return asErrorContent(error, "Query execution failed");
    }
  }
);

server.tool("list_procedures", "List stored procedures in current database", {}, async () => {
  try {
    const connectedPool = await poolConnection;
    const result = await connectedPool.request().query(`
      SELECT SCHEMA_NAME(schema_id) AS schema_name, name
      FROM sys.procedures
      ORDER BY schema_name, name
    `);

    return asTextContent({
      success: true,
      count: result.recordset.length,
      procedures: result.recordset,
    });
  } catch (error) {
    return asErrorContent(error, "Failed to list procedures");
  }
});

server.tool(
  "get_procedure",
  "Get definition of a stored procedure by name (schema.proc or proc)",
  {
    name: z.string().min(1, "name is required"),
  },
  async ({ name }) => {
    try {
      const connectedPool = await poolConnection;
      const result = await connectedPool
        .request()
        .input("name", sql.NVarChar, name)
        .query(`
          SELECT OBJECT_DEFINITION(OBJECT_ID(@name)) AS code
        `);

      const code = result.recordset?.[0]?.code;
      if (!code) {
        return asTextContent({
          success: false,
          error: `Stored procedure not found: ${name}`,
        });
      }

      return asTextContent({
        success: true,
        name,
        definition: code,
      });
    } catch (error) {
      return asErrorContent(error, "Failed to get procedure definition");
    }
  }
);

server.tool(
  "run_procedure",
  "Execute a stored procedure to detect runtime issues. Optional params as JSON object.",
  {
    name: z.string().min(1, "name is required"),
    paramsJson: z.string().optional(),
  },
  async ({ name, paramsJson }) => {
    try {
      const connectedPool = await poolConnection;
      const request = connectedPool.request();

      if (paramsJson) {
        const params = JSON.parse(paramsJson);
        if (typeof params !== "object" || params === null || Array.isArray(params)) {
          return asTextContent({
            success: false,
            error: "paramsJson must be a JSON object",
          });
        }

        for (const [key, value] of Object.entries(params)) {
          request.input(key, value);
        }
      }

      const result = await request.execute(name);

      return asTextContent({
        success: true,
        procedure: name,
        recordset: result.recordset || [],
        rowsAffected: result.rowsAffected,
        output: result.output,
      });
    } catch (error) {
      return asTextContent({
        success: false,
        procedure: name,
        error: error?.message || "Procedure execution failed",
      });
    }
  }
);

server.tool(
  "create_procedure",
  "Create or alter a stored procedure by SQL script",
  {
    sql: z.string().min(1, "sql is required"),
  },
  async ({ sql: script }) => {
    try {
      const normalized = script.trim().toUpperCase();
      if (!normalized.includes("PROCEDURE")) {
        return asTextContent({
          success: false,
          error: "The script must contain a PROCEDURE definition.",
        });
      }

      const connectedPool = await poolConnection;
      await connectedPool.request().batch(script);

      return asTextContent({
        success: true,
        message: "Stored procedure script executed successfully.",
      });
    } catch (error) {
      return asErrorContent(error, "Failed to create procedure");
    }
  }
);

server.tool(
  "validate_procedure",
  "Validate a procedure metadata using sp_refreshsqlmodule",
  {
    name: z.string().min(1, "name is required"),
  },
  async ({ name }) => {
    try {
      const connectedPool = await poolConnection;
      await connectedPool
        .request()
        .input("name", sql.NVarChar, name)
        .query("EXEC sys.sp_refreshsqlmodule @name = @name");

      return asTextContent({
        success: true,
        procedure: name,
        message: "Procedure metadata refresh completed with no SQL error.",
      });
    } catch (error) {
      return asErrorContent(error, "Procedure validation failed");
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function closePoolAndExit(exitCode = 0) {
  try {
    await pool.close();
  } catch {
    // Ignore close errors on shutdown.
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => {
  closePoolAndExit(0);
});

process.on("SIGTERM", () => {
  closePoolAndExit(0);
});
