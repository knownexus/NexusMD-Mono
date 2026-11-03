using System.Net;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>
/// Web:LegacyEndpoints gates the old unauthenticated controllers (ado/config/files/profiles).
/// OAuth endpoints must stay reachable regardless of the flag.
/// </summary>
public class LegacyGateTests
{
    [Theory]
    [InlineData("/api/profiles")]
    [InlineData("/api/config")]
    [InlineData("/api/ado/x")]
    [InlineData("/api/files/x")]
    public async Task Legacy_paths_return_404_when_flag_is_false(string path)
    {
        using var factory = new TestFactory();
        factory.Overrides["Web:LegacyEndpoints"] = "false";
        var client = factory.CreateClient();

        var res = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task OAuth_endpoints_stay_reachable_when_flag_is_false()
    {
        using var factory = new TestFactory();
        factory.Overrides["Web:LegacyEndpoints"] = "false";
        var client = factory.CreateClient();

        var res = await client.GetAsync("/api/google/auth/url");

        Assert.NotEqual(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Legacy_paths_work_by_default_in_tests()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var res = await client.GetAsync("/api/profiles");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}
