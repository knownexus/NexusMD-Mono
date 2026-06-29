using NexusMDWeb.Api.Models;
using Microsoft.Data.Sqlite;

namespace NexusMDWeb.Api.Data;

public class ProfileRepository
{
    private readonly string _connectionString;

    public ProfileRepository(IConfiguration config)
    {
        var dbPath = config["Profiles:DbPath"] ?? "profiles.db";
        if (!Path.IsPathRooted(dbPath))
            dbPath = Path.Combine(AppContext.BaseDirectory, dbPath);
        _connectionString = $"Data Source={dbPath}";
        Initialise();
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private void Initialise()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS Profiles (
                Id        TEXT    PRIMARY KEY,
                Name      TEXT    NOT NULL,
                Initials  TEXT    NOT NULL,
                Color     TEXT    NOT NULL,
                Type      TEXT    NOT NULL DEFAULT 'ado',
                Config    TEXT,
                CreatedAt INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ActiveProfile (
                Singleton INTEGER PRIMARY KEY DEFAULT 1,
                ProfileId TEXT    NOT NULL
            );";
        cmd.ExecuteNonQuery();
    }

    public IReadOnlyList<Profile> GetAll()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,Name,Initials,Color,Type,Config,CreatedAt FROM Profiles ORDER BY CreatedAt";
        var list = new List<Profile>();
        using (var r = cmd.ExecuteReader())
        {
            while (r.Read()) list.Add(Map(r));
        }
        return list;
    }

    public Profile? GetById(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,Name,Initials,Color,Type,Config,CreatedAt FROM Profiles WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (r.Read())
        {
            return Map(r);
        }
        return null;
    }

    public void Create(Profile p)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO Profiles (Id,Name,Initials,Color,Type,Config,CreatedAt) VALUES ($id,$na,$in,$co,$ty,$cf,$ca)";
        cmd.Parameters.AddWithValue("$id", p.Id);
        cmd.Parameters.AddWithValue("$na", p.Name);
        cmd.Parameters.AddWithValue("$in", p.Initials);
        cmd.Parameters.AddWithValue("$co", p.Color);
        cmd.Parameters.AddWithValue("$ty", p.Type);
        cmd.Parameters.AddWithValue("$cf", (object?)p.Config ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ca", p.CreatedAt);
        cmd.ExecuteNonQuery();
    }

    public void Update(Profile p)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Profiles SET Name=$na,Initials=$in,Color=$co,Type=$ty,Config=$cf WHERE Id=$id";
        cmd.Parameters.AddWithValue("$na", p.Name);
        cmd.Parameters.AddWithValue("$in", p.Initials);
        cmd.Parameters.AddWithValue("$co", p.Color);
        cmd.Parameters.AddWithValue("$ty", p.Type);
        cmd.Parameters.AddWithValue("$cf", (object?)p.Config ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$id", p.Id);
        cmd.ExecuteNonQuery();
    }

    public void Delete(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Profiles WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public string? GetActiveId()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT ProfileId FROM ActiveProfile WHERE Singleton=1";
        return cmd.ExecuteScalar() as string;
    }

    public void SetActiveId(string id)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO ActiveProfile (Singleton,ProfileId) VALUES (1,$id)";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    private static Profile Map(SqliteDataReader r) => new(
        r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5), r.GetInt64(6));
}
