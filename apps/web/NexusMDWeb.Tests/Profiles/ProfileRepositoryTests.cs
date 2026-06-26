using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace NexusMDWeb.Tests.Profiles;

public class ProfileRepositoryTests : IDisposable
{
    private readonly ProfileRepository _repo;
    private readonly string _dbPath;

    public ProfileRepositoryTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"profile-test-{Guid.NewGuid():N}.db");
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Profiles:DbPath"] = _dbPath })
            .Build();
        _repo = new ProfileRepository(config);
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
    public void GetAll_returns_empty_list_initially()
    {
        Assert.Empty(_repo.GetAll());
    }

    [Fact]
    public void Create_and_GetById_roundtrip()
    {
        var p = new Profile("id1", "Work", "WK", "#9a7e22", "ado", null, 1000L);
        _repo.Create(p);
        var found = _repo.GetById("id1");
        Assert.NotNull(found);
        Assert.Equal("Work", found!.Name);
        Assert.Equal("WK", found.Initials);
        Assert.Equal("ado", found.Type);
    }

    [Fact]
    public void Create_with_config_roundtrips_config_json()
    {
        var config = """{"org":"mycompany","pat":"secret"}""";
        var p = new Profile("id2", "Work", "WK", "#9a7e22", "ado", config, 1000L);
        _repo.Create(p);
        var found = _repo.GetById("id2");
        Assert.Equal(config, found!.Config);
    }

    [Fact]
    public void Update_changes_name_and_color()
    {
        var p = new Profile("id3", "Old", "OL", "#000", "ado", null, 1000L);
        _repo.Create(p);
        _repo.Update(p with { Name = "New", Color = "#fff" });
        var found = _repo.GetById("id3");
        Assert.Equal("New", found!.Name);
        Assert.Equal("#fff", found.Color);
    }

    [Fact]
    public void Delete_removes_profile()
    {
        _repo.Create(new Profile("id4", "Gone", "GO", "#000", "ado", null, 1000L));
        _repo.Delete("id4");
        Assert.Null(_repo.GetById("id4"));
    }

    [Fact]
    public void GetAll_returns_profiles_in_creation_order()
    {
        _repo.Create(new Profile("a", "Alpha", "AL", "#0", "ado", null, 1L));
        _repo.Create(new Profile("b", "Beta",  "BE", "#0", "ado", null, 2L));
        var all = _repo.GetAll();
        Assert.Equal(2, all.Count);
        Assert.Equal("a", all[0].Id);
        Assert.Equal("b", all[1].Id);
    }

    [Fact]
    public void SetActiveId_and_GetActiveId_roundtrip()
    {
        _repo.Create(new Profile("x", "X", "XX", "#0", "ado", null, 1L));
        _repo.SetActiveId("x");
        Assert.Equal("x", _repo.GetActiveId());
    }

    [Fact]
    public void SetActiveId_twice_updates_to_latest()
    {
        _repo.Create(new Profile("x", "X", "XX", "#0", "ado", null, 1L));
        _repo.Create(new Profile("y", "Y", "YY", "#0", "ado", null, 2L));
        _repo.SetActiveId("x");
        _repo.SetActiveId("y");
        Assert.Equal("y", _repo.GetActiveId());
    }
}