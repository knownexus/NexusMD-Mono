using Microsoft.Data.Sqlite;

namespace NexusMDWeb.Api.Services;

/// <summary>
/// Appends every write action (create/edit WI, PR vote/comment/complete) to a local SQLite database.
/// Singleton — safe because SQLite write serialisation is handled per-connection.
/// </summary>
public class AuditService
{
    private readonly string _connectionString;

    public AuditService(IConfiguration config)
    {
        var dbPath          = config["Audit:DbPath"] ?? "audit.db";
        if (!Path.IsPathRooted(dbPath))
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        _connectionString   = $"Data Source={dbPath}";
    }

    /// <summary>Creates the AuditLog table if it does not already exist.</summary>
    public void Initialise()
    {
        using var conn = OpenConnection();
        ExecuteNonQuery(conn, @"
            CREATE TABLE IF NOT EXISTS AuditLog (
                Id        INTEGER PRIMARY KEY AUTOINCREMENT,
                Timestamp TEXT    NOT NULL,
                Action    TEXT    NOT NULL,
                Entity    TEXT    NOT NULL,
                EntityId  TEXT,
                Details   TEXT,
                UserAgent TEXT
            )");
    }

    /// <summary>Appends a row to the audit log.</summary>
    public void Log(string action, string entity, string? entityId, string? details, HttpRequest request)
    {
        using var conn = OpenConnection();
        using var cmd  = conn.CreateCommand();
        cmd.CommandText =
            "INSERT INTO AuditLog (Timestamp,Action,Entity,EntityId,Details,UserAgent) " +
            "VALUES ($ts,$ac,$en,$ei,$dt,$ua)";

        cmd.Parameters.AddWithValue("$ts", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$ac", action);
        cmd.Parameters.AddWithValue("$en", entity);
        cmd.Parameters.AddWithValue("$ei", entityId ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("$dt", details  ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("$ua", request.Headers.UserAgent.ToString());

        cmd.ExecuteNonQuery();
    }

    /// <summary>Returns the most recent audit entries, newest first.</summary>
    public List<AuditEntry> GetRecentEntries(int count = 200)
    {
        using var conn   = OpenConnection();
        using var cmd    = conn.CreateCommand();
        cmd.CommandText  =
            $"SELECT Id,Timestamp,Action,Entity,EntityId,Details,UserAgent " +
            $"FROM AuditLog ORDER BY Id DESC LIMIT {Math.Min(count, 1000)}";

        using var reader = cmd.ExecuteReader();
        var list = new List<AuditEntry>();

        while (reader.Read())
        {
            list.Add(new AuditEntry(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        }

        return list;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private static void ExecuteNonQuery(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}

/// <summary>A single row from the audit log.</summary>
public record AuditEntry(
    long    Id,
    string  Timestamp,
    string  Action,
    string  Entity,
    string? EntityId,
    string? Details,
    string? UserAgent);