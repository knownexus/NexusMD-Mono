using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace NexusMDWeb.Tests.Infrastructure;

/// <summary>
/// In-memory test host for the slimmed NexusMDWeb.Api (Config + Files bridge only).
///
/// - Supplies sentinel config so tests can assert the PAT never leaks into responses.
/// - Runs against a throwaway content root so file writes (appsettings.user.json,
///   data/profiles/...) never touch the real project directory.
/// </summary>
public sealed class TestFactory : WebApplicationFactory<Program>
{
    /// <summary>Sentinel PAT. Tests assert this value never appears in any response.</summary>
    public const string TestPat     = "super-secret-test-pat-never-expose-me";
    public const string TestOrg     = "test-org";
    public const string TestProject = "TestProject";

    /// <summary>Isolated content root for this factory instance (auto-deleted on dispose).</summary>
    public string ContentRoot { get; } =
        Path.Combine(Path.GetTempPath(), $"nexusmd-web-test-{Guid.NewGuid():N}");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(Path.Combine(ContentRoot, "wwwroot"));
        // Minimal index.html so the SPA fallback / static-file middleware is satisfied.
        File.WriteAllText(Path.Combine(ContentRoot, "wwwroot", "index.html"), "<!doctype html><title>test</title>");

        builder.UseContentRoot(ContentRoot);
        builder.UseWebRoot(Path.Combine(ContentRoot, "wwwroot"));

        builder.ConfigureAppConfiguration((_, cfg) =>
        {
            cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ado:Organisation"]   = TestOrg,
                ["Ado:Pat"]            = TestPat,
                ["Ado:Projects:0"]     = TestProject,
                ["Ado:TestProject"]    = TestProject,
                ["App:RefreshSeconds"] = "30",
                // Keep the profile SQLite db inside the throwaway content root.
                ["Profiles:DbPath"]    = Path.Combine(ContentRoot, "profiles.db"),
                ["Google:ClientId"]      = "test-google-client",
                ["Google:ClientSecret"]  = "test-google-secret",
                ["Microsoft:ClientId"]   = "test-ms-client",
                ["Microsoft:ClientSecret"] = "test-ms-secret",
                ["Microsoft:Tenant"]     = "common",
                ["OAuth:NativeReturnPrefixes:0"] = "nexusmd://",
                ["OAuth:NativeReturnPrefixes:1"] = "http://127.0.0.1",
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            try { if (Directory.Exists(ContentRoot)) Directory.Delete(ContentRoot, recursive: true); }
            catch { /* best-effort cleanup */ }
        }
    }
}
