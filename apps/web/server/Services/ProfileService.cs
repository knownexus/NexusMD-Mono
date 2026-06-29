using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;

namespace NexusMDWeb.Api.Services;

public class ProfileService(ProfileRepository repo)
{
    public IReadOnlyList<Profile> GetAll() => repo.GetAll();

    public Profile? GetById(string id) => repo.GetById(id);

    public Profile Create(string name, string initials, string color, string type, string? config = null)
    {
        var p = new Profile(
            Id:        NewId(),
            Name:      name,
            Initials:  initials.Length > 3 ? initials[..3] : initials,
            Color:     color,
            Type:      type,
            Config:    config,
            CreatedAt: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
        repo.Create(p);
        if (repo.GetAll().Count == 1)
            repo.SetActiveId(p.Id);
        return p;
    }

    public Profile? Update(string id, string? name, string? initials, string? color, string? type, string? config)
    {
        var existing = repo.GetById(id);
        if (existing is null) return null;
        var updated = existing with
        {
            Name     = name     ?? existing.Name,
            Initials = initials is not null
                ? (initials.Length > 3 ? initials[..3] : initials)
                : existing.Initials,
            Color    = color    ?? existing.Color,
            Type     = type     ?? existing.Type,
            Config   = config   ?? existing.Config,
        };
        repo.Update(updated);
        return updated;
    }

    public bool Delete(string id)
    {
        if (repo.GetAll().Count <= 1) return false;
        var activeId = repo.GetActiveId();
        repo.Delete(id);
        if (activeId == id)
        {
            var remaining = repo.GetAll();
            if (remaining.Count > 0) repo.SetActiveId(remaining[0].Id);
        }
        return true;
    }

    public Profile? Activate(string id)
    {
        var p = repo.GetById(id);
        if (p is null) return null;
        repo.SetActiveId(id);
        return p;
    }

    public void Import(IEnumerable<Profile> records, string? activeId)
    {
        foreach (var p in records) repo.Upsert(p);
        if (!string.IsNullOrEmpty(activeId) && repo.GetById(activeId) is not null)
            repo.SetActiveId(activeId);
        else if (repo.GetActiveId() is null)
        {
            var all = repo.GetAll();
            if (all.Count > 0) repo.SetActiveId(all[0].Id);
        }
    }

    public (Profile? profile, string? activeId) GetState()
    {
        var activeId = repo.GetActiveId();
        var profile  = activeId is not null ? repo.GetById(activeId) : null;
        return (profile, activeId);
    }

    private static string NewId() =>
        Guid.NewGuid().ToString("N")[..12] + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("x");
}
