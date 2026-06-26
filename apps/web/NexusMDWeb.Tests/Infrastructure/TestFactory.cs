using NexusMDWeb.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestPlatform.TestHost;

namespace NexusMDWeb.Tests.Infrastructure;

/// <summary>
/// In-memory test host for the full NexusMDWeb.Api application.
///
/// Configuration overrides:
///   - Uses known sentinel values for Org/PAT/Projects so tests can assert
///     that these values never leak into responses.
///   - Audit database is written to a temp file to avoid polluting the repo.
///
/// AdoClient is re-registered directly with FakeAdoHandler so there is no
/// ambiguity about which HttpMessageHandler the typed client uses.
/// This bypasses IHttpClientFactory's handler caching, which can otherwise
/// prevent the test handler from taking effect.
/// </summary>
public sealed class TestFactory : WebApplicationFactory<Program>
{
    /// <summary>Sentinel PAT value. Tests assert this never appears in any response body.</summary>
    public const string TestPat     = "super-secret-test-pat-never-expose-me";
    public const string TestOrg     = "test-org";
    public const string TestProject = "TestProject";

    /// <summary>The handler that intercepts all outbound ADO HTTP calls.</summary>
    public FakeAdoHandler FakeHandler { get; } = new FakeAdoHandler();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, cfg) =>
        {
            cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ado:Organisation"]   = TestOrg,
                ["Ado:Pat"]            = TestPat,
                ["Ado:Projects:0"]     = TestProject,
                ["Ado:TestProject"]    = TestProject,
                ["App:RefreshSeconds"] = "30",
                // Temp file so the SQLite DB doesn't litter the repo directory
                ["Audit:DbPath"]       = Path.Combine(
                    Path.GetTempPath(),
                    $"ado-test-audit-{Guid.NewGuid():N}.db"),
                ["Profiles:DbPath"]    = Path.Combine(
                    Path.GetTempPath(),
                    $"profile-ctrl-test-{Guid.NewGuid():N}.db"),
            });
        });

        builder.ConfigureTestServices(services =>
        {
            // Remove ALL existing AdoClient DI registrations (the typed-client
            // infrastructure can register more than one) then add a direct factory
            // that creates AdoClient with a plain HttpClient backed by FakeAdoHandler.
            // This completely bypasses IHttpClientFactory handler-pipeline caching,
            // which is the most reliable way to guarantee the fake is always used.
            var existing = services
                .Where(d => d.ServiceType == typeof(AdoClient))
                .ToList();
            foreach (var d in existing)
            {
                services.Remove(d);
            }

            services.AddTransient<AdoClient>(sp =>
            {
                var config = sp.GetRequiredService<IConfiguration>();
                // disposeHandler:false — FakeHandler is owned by TestFactory, not HttpClient
                var httpClient = new HttpClient(FakeHandler, disposeHandler: false);
                return new AdoClient(httpClient, config);
            });
        });
    }
}