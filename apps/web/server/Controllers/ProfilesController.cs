using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Services;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Profile registry consumed by the frontend (profile-setup.jsx first-run flow +
/// profile-context.jsx). Backed by ProfileService/ProfileRepository (SQLite). The
/// per-profile `config` blob (ADO org/PAT, GitHub PAT/repos) is stored opaque.
/// </summary>
[ApiController]
[Route("api/profiles")]
public class ProfilesController(ProfileService profiles) : ControllerBase
{
    // GET /api/profiles/active → { profiles: [...], activeId }
    [HttpGet("active")]
    public IActionResult Active()
    {
        var (_, activeId) = profiles.GetState();
        return Ok(new { profiles = profiles.GetAll(), activeId });
    }

    // GET /api/profiles → [ ... ]
    [HttpGet]
    public IActionResult GetAll() => Ok(profiles.GetAll());

    // POST /api/profiles → create, returns the new profile
    [HttpPost]
    public IActionResult Create([FromBody] CreateProfileRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.Initials))
            return BadRequest(new { error = "name and initials are required" });
        var p = profiles.Create(
            req.Name.Trim(),
            req.Initials.Trim(),
            string.IsNullOrWhiteSpace(req.Color) ? "#9a7e22" : req.Color,
            string.IsNullOrWhiteSpace(req.Type) ? "ado" : req.Type,
            req.Config);
        return Ok(p);
    }

    // PUT /api/profiles/{id} → update
    [HttpPut("{id}")]
    public IActionResult Update(string id, [FromBody] UpdateProfileRequest req)
    {
        var updated = profiles.Update(id, req.Name, req.Initials, req.Color, req.Type, req.Config);
        return updated is null ? NotFound(new { error = "profile not found" }) : Ok(updated);
    }

    // DELETE /api/profiles/{id}
    [HttpDelete("{id}")]
    public IActionResult Delete(string id)
        => profiles.Delete(id)
            ? Ok(new { ok = true })
            : BadRequest(new { error = "cannot delete the only profile" });

    // POST /api/profiles/{id}/activate
    [HttpPost("{id}/activate")]
    public IActionResult Activate(string id)
    {
        var p = profiles.Activate(id);
        return p is null ? NotFound(new { error = "profile not found" }) : Ok(p);
    }

    // POST /api/profiles/import → upsert by id + set active (restore-by-id)
    [HttpPost("import")]
    public IActionResult Import([FromBody] ImportRequest req)
    {
        if (req?.Profiles is null) return BadRequest(new { error = "profiles required" });
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var records = req.Profiles.Select(d => new NexusMDWeb.Api.Models.Profile(
            Id: d.Id, Name: d.Name, Initials: d.Initials, Color: d.Color, Type: d.Type,
            Config: d.Config, CreatedAt: d.CreatedAt == 0 ? now : d.CreatedAt));
        profiles.Import(records, req.ActiveId);
        return Ok(new { imported = req.Profiles.Count });
    }
}

public record CreateProfileRequest(
    string Name, string Initials, string? Color = null, string? Type = null, string? Config = null);

public record UpdateProfileRequest(
    string? Name = null, string? Initials = null, string? Color = null, string? Type = null, string? Config = null);

public record ImportProfileDto(
    string Id, string Name, string Initials, string Color, string Type,
    string? Config = null, long CreatedAt = 0);

public record ImportRequest(System.Collections.Generic.List<ImportProfileDto> Profiles, string? ActiveId = null);
