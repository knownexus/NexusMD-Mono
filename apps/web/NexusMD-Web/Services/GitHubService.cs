using Microsoft.Extensions.Caching.Memory;
using System.Net.Http.Headers;
using System.Text.Json;

namespace NexusMDWeb.Api.Services;

// ── Mapped DTOs ───────────────────────────────────────────────────────────────

public record GhPullRequest(
    int    Id, string Title, string Author, bool Draft, string State,
    string Branch, string Url, string Created, string Updated,
    IReadOnlyList<GhReviewer> Reviewers, string Repo);

public record GhReviewer(string Login, string State);

public record GhIssue(
    int    Id, string Title, string Author, string State,
    string? Assignee, string? Milestone, IReadOnlyList<string> Tags,
    string Url, string Created, string Updated, string Repo);

public record GhWorkflowRun(
    long   Id, string Name, string Status, string NexusMDStatus,
    string Branch, string Created, string Url, string Repo);

public record GhTeamMember(string Login, string AvatarUrl, int Contributions);

public class GitHubService(HttpClient http, IMemoryCache cache)
{
    // ── Pull Requests ─────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<GhPullRequest>> GetPullRequestsAsync(
        string pat, IEnumerable<string> repos, CancellationToken ct)
    {
        var key = $"gh:prs:{pat.GetHashCode()}:{string.Join(',', repos)}";
        if (cache.TryGetValue(key, out IReadOnlyList<GhPullRequest>? cached)) return cached!;

        var tasks = repos.Select(r => FetchPrsForRepo(pat, r, ct)).ToArray();
        var all   = (await Task.WhenAll(tasks)).SelectMany(x => x).ToList();

        cache.Set(key, (IReadOnlyList<GhPullRequest>)all, TimeSpan.FromSeconds(60));
        return all;
    }

    private async Task<List<GhPullRequest>> FetchPrsForRepo(string pat, string repo, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, $"repos/{repo}/pulls?state=open&per_page=100", pat);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.EnumerateArray().Select(pr => new GhPullRequest(
            Id:        pr.GetProperty("number").GetInt32(),
            Title:     pr.GetProperty("title").GetString() ?? "",
            Author:    pr.TryGetProperty("user", out var u) ? u.GetProperty("login").GetString() ?? "" : "",
            Draft:     pr.TryGetProperty("draft", out var d) && d.GetBoolean(),
            State:     pr.GetProperty("state").GetString() ?? "open",
            Branch:    pr.TryGetProperty("head", out var h) ? h.GetProperty("ref").GetString() ?? "" : "",
            Url:       pr.GetProperty("html_url").GetString() ?? "",
            Created:   pr.GetProperty("created_at").GetString() ?? "",
            Updated:   pr.GetProperty("updated_at").GetString() ?? "",
            Reviewers: MapReviewers(pr),
            Repo:      repo
        )).ToList();
    }

    private static IReadOnlyList<GhReviewer> MapReviewers(JsonElement pr)
    {
        if (!pr.TryGetProperty("requested_reviewers", out var rr)) return [];
        return rr.EnumerateArray()
            .Select(r => new GhReviewer(r.GetProperty("login").GetString() ?? "", "PENDING"))
            .ToList();
    }

    // ── Issues ────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<GhIssue>> GetIssuesAsync(
        string pat, IEnumerable<string> repos, CancellationToken ct)
    {
        var key = $"gh:issues:{pat.GetHashCode()}:{string.Join(',', repos)}";
        if (cache.TryGetValue(key, out IReadOnlyList<GhIssue>? cached)) return cached!;

        var tasks = repos.Select(r => FetchIssuesForRepo(pat, r, ct)).ToArray();
        var all   = (await Task.WhenAll(tasks)).SelectMany(x => x).ToList();

        cache.Set(key, (IReadOnlyList<GhIssue>)all, TimeSpan.FromSeconds(60));
        return all;
    }

    private async Task<List<GhIssue>> FetchIssuesForRepo(string pat, string repo, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, $"repos/{repo}/issues?state=open&per_page=100", pat);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.EnumerateArray()
            .Where(i => !(i.TryGetProperty("pull_request", out var pr) && pr.ValueKind != JsonValueKind.Null))
            .Select(i => new GhIssue(
                Id:        i.GetProperty("number").GetInt32(),
                Title:     i.GetProperty("title").GetString() ?? "",
                Author:    i.TryGetProperty("user", out var u) ? u.GetProperty("login").GetString() ?? "" : "",
                State:     i.GetProperty("state").GetString() ?? "open",
                Assignee:  i.TryGetProperty("assignee", out var a) && a.ValueKind != JsonValueKind.Null ? a.GetProperty("login").GetString() : null,
                Milestone: i.TryGetProperty("milestone", out var m) && m.ValueKind != JsonValueKind.Null ? m.GetProperty("title").GetString() : null,
                Tags:      i.TryGetProperty("labels", out var lbs) ? lbs.EnumerateArray().Select(l => l.GetProperty("name").GetString() ?? "").ToList() : [],
                Url:       i.GetProperty("html_url").GetString() ?? "",
                Created:   i.GetProperty("created_at").GetString() ?? "",
                Updated:   i.GetProperty("updated_at").GetString() ?? "",
                Repo:      repo
            )).ToList();
    }

    // ── Workflow Runs (builds equivalent) ────────────────────────────────────

    public async Task<IReadOnlyList<GhWorkflowRun>> GetWorkflowRunsAsync(
        string pat, IEnumerable<string> repos, CancellationToken ct)
    {
        var key = $"gh:runs:{pat.GetHashCode()}:{string.Join(',', repos)}";
        if (cache.TryGetValue(key, out IReadOnlyList<GhWorkflowRun>? cached)) return cached!;

        var tasks = repos.Select(r => FetchRunsForRepo(pat, r, ct)).ToArray();
        var all   = (await Task.WhenAll(tasks)).SelectMany(x => x).ToList();

        cache.Set(key, (IReadOnlyList<GhWorkflowRun>)all, TimeSpan.FromSeconds(30));
        return all;
    }

    private async Task<List<GhWorkflowRun>> FetchRunsForRepo(string pat, string repo, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, $"repos/{repo}/actions/runs?per_page=30", pat);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        if (!doc.RootElement.TryGetProperty("workflow_runs", out var runs)) return [];
        return runs.EnumerateArray().Select(r => new GhWorkflowRun(
            Id:         r.GetProperty("id").GetInt64(),
            Name:       r.GetProperty("name").GetString() ?? "",
            Status:     r.GetProperty("status").GetString() ?? "",
            NexusMDStatus: ToNexusMDStatus(r.GetProperty("status").GetString(), r.TryGetProperty("conclusion", out var c) && c.ValueKind != JsonValueKind.Null ? c.GetString() : null),
            Branch:     r.GetProperty("head_branch").GetString() ?? "",
            Created:    r.GetProperty("created_at").GetString() ?? "",
            Url:        r.GetProperty("html_url").GetString() ?? "",
            Repo:       repo
        )).ToList();
    }

    private static string ToNexusMDStatus(string? status, string? conclusion) => (status, conclusion) switch
    {
        ("in_progress", _)       => "running",
        ("queued", _)            => "running",
        (_, "success")           => "success",
        (_, "failure")           => "failed",
        (_, "cancelled")         => "cancelled",
        (_, "skipped")           => "cancelled",
        (_, "timed_out")         => "failed",
        (_, "action_required")   => "failed",
        _                        => "unknown",
    };

    // ── Team (contributors) ───────────────────────────────────────────────────

    public async Task<IReadOnlyList<GhTeamMember>> GetTeamAsync(
        string pat, IEnumerable<string> repos, CancellationToken ct)
    {
        var key = $"gh:team:{pat.GetHashCode()}:{string.Join(',', repos)}";
        if (cache.TryGetValue(key, out IReadOnlyList<GhTeamMember>? cached)) return cached!;

        var tasks = repos.Select(r => FetchContributorsForRepo(pat, r, ct)).ToArray();
        var all   = (await Task.WhenAll(tasks)).SelectMany(x => x)
                    .GroupBy(m => m.Login)
                    .Select(g => g.OrderByDescending(m => m.Contributions).First())
                    .OrderByDescending(m => m.Contributions)
                    .ToList();

        cache.Set(key, (IReadOnlyList<GhTeamMember>)all, TimeSpan.FromMinutes(10));
        return all;
    }

    private async Task<List<GhTeamMember>> FetchContributorsForRepo(string pat, string repo, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, $"repos/{repo}/contributors?per_page=100", pat);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.EnumerateArray().Select(c => new GhTeamMember(
            Login:         c.GetProperty("login").GetString() ?? "",
            AvatarUrl:     c.TryGetProperty("avatar_url", out var av) ? av.GetString() ?? "" : "",
            Contributions: c.GetProperty("contributions").GetInt32()
        )).ToList();
    }

    // ── Repos list (for settings screen) ─────────────────────────────────────

    public async Task<IReadOnlyList<string>> GetReposAsync(string pat, string? orgOrUser, CancellationToken ct)
    {
        var path = orgOrUser is not null ? $"orgs/{orgOrUser}/repos?per_page=100&sort=updated" : "user/repos?per_page=100&sort=updated";
        using var req = BuildRequest(HttpMethod.Get, path, pat);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.EnumerateArray()
            .Select(r => r.GetProperty("full_name").GetString() ?? "")
            .Where(n => n.Length > 0).ToList();
    }

    // ── OAuth ─────────────────────────────────────────────────────────────────

    public async Task<string?> ExchangeCodeForTokenAsync(string code, string clientId, string clientSecret, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"]     = clientId,
                ["client_secret"] = clientSecret,
                ["code"]          = code,
            })
        };
        req.Headers.Accept.ParseAdd("application/json");
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("access_token", out var t) ? t.GetString() : null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static HttpRequestMessage BuildRequest(HttpMethod method, string relPath, string pat)
    {
        var req = new HttpRequestMessage(method, relPath);
        req.Headers.Authorization = new AuthenticationHeaderValue("token", pat);
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        return req;
    }
}