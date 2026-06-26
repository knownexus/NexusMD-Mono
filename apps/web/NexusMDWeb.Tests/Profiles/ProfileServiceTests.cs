using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Services;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace NexusMDWeb.Tests.Profiles;

public class ProfileServiceTests : IDisposable
{
    private readonly ProfileService _svc;
    private readonly string _dbPath;

    public ProfileServiceTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"profile-svc-test-{Guid.NewGuid():N}.db");
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Profiles:DbPath"] = _dbPath })
            .Build();
        _svc = new ProfileService(new ProfileRepository(config));
    }

    public void Dispose()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        Thread.Sleep(100);
        if (File.Exists(_dbPath))
        {
            try
            {
                File.Delete(_dbPath);
            }
            catch
            {
                // SQLite might still have locks; ignore
            }
        }
        // Clean up WAL and SHM files too
        try
        {
            File.Delete($"{_dbPath}-wal");
        }
        catch { }
        try
        {
            File.Delete($"{_dbPath}-shm");
        }
        catch { }
    }

    [Fact]
    public void Create_returns_profile_with_generated_id()
    {
        var p = _svc.Create("Work", "WK", "#9a7e22", "ado");
        Assert.NotEmpty(p.Id);
        Assert.Equal("Work", p.Name);
        Assert.Equal("WK", p.Initials);
        Assert.Equal("ado", p.Type);
    }

    [Fact]
    public void Create_truncates_initials_to_3_chars()
    {
        var p = _svc.Create("Work", "WORK", "#0", "ado");
        Assert.Equal("WOR", p.Initials);
    }

    [Fact]
    public void Create_first_profile_auto_activates()
    {
        var p = _svc.Create("Work", "WK", "#0", "ado");
        var (active, id) = _svc.GetState();
        Assert.Equal(p.Id, id);
        Assert.Equal("Work", active!.Name);
    }

    [Fact]
    public void Create_second_profile_does_not_change_active()
    {
        var first = _svc.Create("First", "F1", "#0", "ado");
        _svc.Create("Second", "S2", "#0", "ado");
        var (_, activeId) = _svc.GetState();
        Assert.Equal(first.Id, activeId);
    }

    [Fact]
    public void Update_changes_fields()
    {
        var p = _svc.Create("Old", "OL", "#000", "ado");
        _svc.Update(p.Id, name: "New", initials: null, color: "#fff", type: null, config: null);
        var updated = _svc.GetById(p.Id);
        Assert.Equal("New", updated!.Name);
        Assert.Equal("#fff", updated.Color);
        Assert.Equal("OL", updated.Initials); // unchanged
    }

    [Fact]
    public void Delete_succeeds_when_multiple_profiles_exist()
    {
        var p1 = _svc.Create("One", "O1", "#0", "ado");
        _svc.Create("Two", "T2", "#0", "ado");
        var ok = _svc.Delete(p1.Id);
        Assert.True(ok);
        Assert.Null(_svc.GetById(p1.Id));
    }

    [Fact]
    public void Delete_fails_when_only_one_profile()
    {
        var p = _svc.Create("Only", "ON", "#0", "ado");
        var ok = _svc.Delete(p.Id);
        Assert.False(ok);
        Assert.NotNull(_svc.GetById(p.Id));
    }

    [Fact]
    public void Delete_active_profile_switches_to_first_remaining()
    {
        var p1 = _svc.Create("One", "O1", "#0", "ado");
        var p2 = _svc.Create("Two", "T2", "#0", "ado");
        _svc.Activate(p1.Id);
        _svc.Delete(p1.Id);
        var (_, activeId) = _svc.GetState();
        Assert.Equal(p2.Id, activeId);
    }

    [Fact]
    public void Activate_returns_profile_with_config()
    {
        var config = """{"org":"myco","pat":"tok"}""";
        var p = _svc.Create("Work", "WK", "#0", "ado", config);
        var activated = _svc.Activate(p.Id);
        Assert.NotNull(activated);
        Assert.Equal(config, activated!.Config);
    }

    [Fact]
    public void Activate_unknown_id_returns_null()
    {
        Assert.Null(_svc.Activate("does-not-exist"));
    }
}