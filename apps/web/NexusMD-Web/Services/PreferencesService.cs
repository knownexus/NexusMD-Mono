using Microsoft.Data.Sqlite;

namespace NexusMDWeb.Api.Services;

/// <summary>
/// Persists user preferences as key-value pairs in a local SQLite database.
/// Values are stored as pre-serialised JSON strings (exactly as localStorage would hold them).
/// Singleton — SQLite write serialisation handled per-connection.
/// </summary>
public class PreferencesService
{
    private readonly string _connectionString;

    public PreferencesService(IConfiguration config)
    {
        var dbPath        = config["Prefs:DbPath"] ?? "prefs.db";
        if (!Path.IsPathRooted(dbPath))
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        _connectionString = $"Data Source={dbPath}";
    }

    public void Initialise()
    {
        using var conn = OpenConnection();
        ExecuteNonQuery(conn, @"
            CREATE TABLE IF NOT EXISTS UserPrefs (
                Key       TEXT PRIMARY KEY,
                Value     TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL
            )");
    }

    /// <summary>Returns all stored preferences as a key → serialised-JSON-value dictionary.</summary>
    public Dictionary<string, string> GetAll()
    {
        using var conn = OpenConnection();
        using var cmd  = conn.CreateCommand();
        cmd.CommandText = "SELECT Key, Value FROM UserPrefs";

        using var reader = cmd.ExecuteReader();
        var result = new Dictionary<string, string>();
        while (reader.Read())
            result[reader.GetString(0)] = reader.GetString(1);

        return result;
    }

    /// <summary>Upserts the provided key-value pairs. Existing keys are overwritten.</summary>
    public void SetAll(Dictionary<string, string> prefs)
    {
        if (prefs.Count == 0) return;

        using var conn = OpenConnection();
        using var tx   = conn.BeginTransaction();

        foreach (var (key, value) in prefs)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "INSERT OR REPLACE INTO UserPrefs (Key, Value, UpdatedAt) VALUES ($k, $v, $ts)";
            cmd.Parameters.AddWithValue("$k",  key);
            cmd.Parameters.AddWithValue("$v",  value);
            cmd.Parameters.AddWithValue("$ts", DateTime.UtcNow.ToString("O"));
            cmd.ExecuteNonQuery();
        }

        tx.Commit();
    }

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