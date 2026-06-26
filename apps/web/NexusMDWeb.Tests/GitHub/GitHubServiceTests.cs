using NexusMDWeb.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Xunit;

namespace NexusMDWeb.Tests.GitHub;

public class GitHubServiceTests
{
    private static GitHubService MakeService(FakeGitHubHandler handler)
    {
        var http  = new HttpClient(handler, disposeHandler: false) { BaseAddress = new Uri("https://api.github.com/") };
        var cache = new MemoryCache(Options.Create(new MemoryCacheOptions()));
        return new GitHubService(http, cache);
    }

    [Fact]
    public async Task GetPullRequests_sends_correct_auth_header()
    {
        var handler = new FakeGitHubHandler();
        handler.Responses["/repos/myorg/myrepo/pulls?state=open&per_page=100"] =
            """[{"number":1,"title":"Fix bug","user":{"login":"alice"},"draft":false,"state":"open","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","html_url":"https://github.com/myorg/myrepo/pull/1","requested_reviewers":[]}]""";

        var svc = MakeService(handler);
        var prs = await svc.GetPullRequestsAsync("test-pat", new[] { "myorg/myrepo" }, default);

        Assert.Single(prs);
        Assert.Equal(1, prs[0].Id);
        Assert.Equal("Fix bug", prs[0].Title);
        var call = handler.Calls.First();
        Assert.Equal("token test-pat", call.AuthHeader);
    }

    [Fact]
    public async Task GetIssues_maps_labels_to_tags()
    {
        var handler = new FakeGitHubHandler();
        handler.Responses["/repos/myorg/myrepo/issues?state=open&per_page=100"] =
            """[{"number":42,"title":"Bug report","state":"open","user":{"login":"bob"},"labels":[{"name":"bug"},{"name":"priority:high"}],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","html_url":"https://github.com/myorg/myrepo/issues/42","assignee":null,"milestone":null,"pull_request":null}]""";

        var svc = MakeService(handler);
        var issues = await svc.GetIssuesAsync("test-pat", new[] { "myorg/myrepo" }, default);

        Assert.Single(issues);
        Assert.Equal("Bug report", issues[0].Title);
        Assert.Contains("bug", issues[0].Tags);
        Assert.Contains("priority:high", issues[0].Tags);
    }

    [Fact]
    public async Task GetWorkflowRuns_maps_conclusion_to_nexusMDStatus()
    {
        var handler = new FakeGitHubHandler();
        handler.Responses["/repos/myorg/myrepo/actions/runs?per_page=30"] =
            """{"workflow_runs":[{"id":100,"name":"CI","status":"completed","conclusion":"success","head_branch":"main","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z","html_url":"https://github.com/myorg/myrepo/actions/runs/100"}]}""";

        var svc = MakeService(handler);
        var runs = await svc.GetWorkflowRunsAsync("test-pat", new[] { "myorg/myrepo" }, default);

        Assert.Single(runs);
        Assert.Equal("success", runs[0].NexusMDStatus);
        Assert.Equal("main", runs[0].Branch);
    }

    [Fact]
    public async Task GetTeam_deduplicates_contributors_across_repos()
    {
        var handler = new FakeGitHubHandler();
        handler.Responses["/repos/myorg/myrepo/contributors?per_page=100"] =
            """[{"login":"alice","avatar_url":"https://avatars.githubusercontent.com/alice","contributions":10},{"login":"bob","avatar_url":"","contributions":5}]""";
        handler.Responses["/repos/myorg/other/contributors?per_page=100"] =
            """[{"login":"alice","avatar_url":"https://avatars.githubusercontent.com/alice","contributions":3}]""";

        var svc = MakeService(handler);
        var team = await svc.GetTeamAsync("test-pat", new[] { "myorg/myrepo", "myorg/other" }, default);

        Assert.Equal(2, team.Count);
        Assert.Single(team, m => m.Login == "alice");
    }
}