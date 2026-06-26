using Microsoft.AspNetCore.Mvc;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Provides a sandboxed file-storage API for the browser frontend.
/// All paths are resolved relative to a safe base directory — path traversal is blocked.
/// </summary>
[ApiController]
[Route("api/files")]
public class FilesController(IWebHostEnvironment env) : ControllerBase
{
    // Profiles are stored under <contentRoot>/data/profiles/
    private string BaseDir => Path.Combine(env.ContentRootPath, "data", "profiles");

    // ── GET /api/files/default-dir ────────────────────────────────────────────

    [HttpGet("default-dir")]
    public IActionResult DefaultDir()
    {
        EnsureBaseDir();
        return Ok(new { path = BaseDir });
    }

    // ── GET /api/files/content?path= ──────────────────────────────────────────

    [HttpGet("content")]
    public IActionResult Read([FromQuery] string path)
    {
        var safe = Resolve(path);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        if (!System.IO.File.Exists(safe)) return NotFound();
        return Content(System.IO.File.ReadAllText(safe), "text/plain");
    }

    // ── POST /api/files/content?path= ─────────────────────────────────────────

    [HttpPost("content")]
    public async Task<IActionResult> Write([FromQuery] string path)
    {
        var safe = Resolve(path);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        Directory.CreateDirectory(Path.GetDirectoryName(safe)!);
        var content = await new StreamReader(Request.Body).ReadToEndAsync();
        // Atomic write: write to .tmp then rename
        var tmp = safe + ".tmp";
        await System.IO.File.WriteAllTextAsync(tmp, content);
        System.IO.File.Move(tmp, safe, overwrite: true);
        return Ok();
    }

    // ── GET /api/files/exists?path= ───────────────────────────────────────────

    [HttpGet("exists")]
    public IActionResult Exists([FromQuery] string path)
    {
        var safe = Resolve(path);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        return Ok(new { exists = System.IO.File.Exists(safe) || Directory.Exists(safe) });
    }

    // ── GET /api/files/list?dir= ──────────────────────────────────────────────

    [HttpGet("list")]
    public IActionResult List([FromQuery] string dir)
    {
        var safe = Resolve(dir);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        if (!Directory.Exists(safe)) return Ok(Array.Empty<string>());
        var entries = Directory.GetFileSystemEntries(safe)
                               .Select(Path.GetFileName)
                               .ToArray();
        return Ok(entries);
    }

    // ── DELETE /api/files/content?path= ──────────────────────────────────────

    [HttpDelete("content")]
    public IActionResult Delete([FromQuery] string path)
    {
        var safe = Resolve(path);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        if (System.IO.File.Exists(safe)) System.IO.File.Delete(safe);
        return Ok();
    }

    // ── POST /api/files/dir?path= ─────────────────────────────────────────────

    [HttpPost("dir")]
    public IActionResult Mkdir([FromQuery] string path)
    {
        var safe = Resolve(path);
        if (safe is null) return BadRequest(new { error = "Invalid path" });
        Directory.CreateDirectory(safe);
        return Ok();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Resolve a client-supplied path against BaseDir and verify it stays within.
    /// Returns null if the resolved path escapes the sandbox.
    /// </summary>
    private string? Resolve(string? clientPath)
    {
        if (string.IsNullOrWhiteSpace(clientPath)) return BaseDir;
        EnsureBaseDir();
        var full = Path.GetFullPath(Path.Combine(BaseDir, clientPath.TrimStart('/', '\\')));
        return full.StartsWith(BaseDir, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    private void EnsureBaseDir() => Directory.CreateDirectory(BaseDir);
}
