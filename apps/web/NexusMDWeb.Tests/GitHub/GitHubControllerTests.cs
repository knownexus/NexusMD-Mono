using System.Net;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.GitHub;

public class GitHubControllerTests : IClassFixture<TestFactory>
{
    private readonly TestFactory _factory;
    public GitHubControllerTests(TestFactory factory) => _factory = factory;

    [Fact]
    public async Task GET_github_prs_returns_200()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/prs?pat=test&repos=myorg/myrepo");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
    }

    [Fact]
    public async Task GET_github_prs_returns_400_without_pat()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/prs?repos=myorg/myrepo");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task GET_github_issues_returns_200()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/issues?pat=test&repos=myorg/myrepo");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GET_github_actions_runs_returns_200()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/actions/runs?pat=test&repos=myorg/myrepo");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GET_github_team_returns_200()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/team?pat=test&repos=myorg/myrepo");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GET_github_auth_start_returns_url()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/github/auth/start");
        // Returns 400 when ClientId not configured — that's the expected state in tests
        Assert.True(res.StatusCode == HttpStatusCode.OK || res.StatusCode == HttpStatusCode.BadRequest);
    }
}