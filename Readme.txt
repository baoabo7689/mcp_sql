MCP SQL Server (Node.js)

MCP server nay cho phep Copilot ket noi SQL Server va thao tac theo flow trong docs/steps.txt:
- List tables
- Query table (read-only)
- List stored procedures
- View stored procedure definition
- Run stored procedure de detect issue runtime
- Create/alter stored procedure
- Validate stored procedure metadata

1) Cai dat

- Node.js 20+
- SQL Server co tai khoan truy cap

Chay lenh:

npm install

2) Cau hinh ket noi database

Copy .env.example thanh .env va cap nhat gia tri:

SQL_USER=sa
SQL_PASSWORD=your_password
SQL_SERVER=localhost
SQL_DATABASE=mydb
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
SQL_CONNECTION_TIMEOUT=15000
SQL_REQUEST_TIMEOUT=30000

3) Chay MCP server

npm start

Server su dung stdio transport de Copilot MCP goi tools.

4) Tool da ho tro

- list_tables
	Input: none
	Output: danh sach bang schema + table

- query_sql
	Input: { "sql": "SELECT TOP 10 * FROM dbo.Users" }
	Note: chi cho phep SELECT/WITH de an toan

- list_procedures
	Input: none
	Output: danh sach stored procedures

- get_procedure
	Input: { "name": "dbo.usp_GetUsers" }
	Output: noi dung procedure

- run_procedure
	Input: { "name": "dbo.usp_GetUsers", "paramsJson": "{\"UserId\":1}" }
	Output: recordset, output, rowsAffected hoac loi runtime

- create_procedure
	Input: { "sql": "CREATE OR ALTER PROCEDURE ..." }
	Output: trang thai tao/cap nhat procedure

- validate_procedure
	Input: { "name": "dbo.usp_GetUsers" }
	Output: ket qua validate metadata

5) Cau hinh cho Copilot MCP (tham khao)

Tao file .vscode/mcp.json:

{
	"servers": {
		"sql-mcp-server": {
			"command": "node",
			"args": ["server.js"],
			"env": {
				"SQL_USER": "sa",
				"SQL_PASSWORD": "your_password",
				"SQL_SERVER": "localhost",
				"SQL_DATABASE": "mydb",
				"SQL_PORT": "1433",
				"SQL_ENCRYPT": "false",
				"SQL_TRUST_SERVER_CERTIFICATE": "true"
			}
		}
	}
}

Sau do mo lai cua so VS Code (neu can) de Copilot nhan MCP server.
