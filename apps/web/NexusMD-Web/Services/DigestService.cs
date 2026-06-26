using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using NexusMDWeb.Api.Controllers;

namespace NexusMDWeb.Api.Services;

/// <summary>
/// Generates and optionally emails the daily manager digest.
/// Runs as a hosted background service; fires once per day at the configured hour.
/// Also exposes CompileDigestAsync() for on-demand calls from DigestController.
/// </summary>
public class DigestService(AdoClient ado, IConfiguration config, ILogger<DigestService> log)
    : BackgroundService
{
    // ── Background scheduling ──────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var hour = int.TryParse(config["Email:DigestHour"], out var h) ? h : 8;
                var now  = DateTime.Now;
                var next = now.Date.AddHours(hour);
                if (next <= now)
                {
                    next = next.AddDays(1);
                }

                var delay = next - now;
                log.LogInformation("Digest scheduled for {Next} ({Delay:hh\\:mm} from now)", next, delay);

                await Task.Delay(delay, ct);
                if (ct.IsCancellationRequested)
                {
                    break;
                }

                if (config["Email:Enabled"]?.Equals("true", StringComparison.OrdinalIgnoreCase) == true)
                {
                    var digest = await CompileDigestAsync(ct: ct);
                    await SendEmailAsync(digest, ct);
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogError(ex, "Digest background job failed"); }
        }
    }

    // ── Digest data assembly ───────────────────────────────────────────────────

    public async Task<ManagerDigest> CompileDigestAsync(int staleDays = 3, CancellationToken ct = default)
    {
        var projects    = config.GetSection("Ado:Projects").Get<string[]>() ?? [];
        var testProject = config["Ado:TestProject"] ?? "";
        var uatProject  = config["Uat:Project"]     ?? "";
        var uatPipeId   = int.TryParse(config["Uat:PipelineId"], out var pid) ? pid : 0;

        var failingBuilds  = new List<FailingBuildSummary>();
        var unassignedWIs  = new List<UnassignedWorkItemSummary>();
        var stalePRs       = new List<StalePullRequestSummary>();

        // Fetch all in parallel
        var buildTask = FetchFailingBuildsAsync(projects, failingBuilds, ct);
        var wiTask    = FetchUnassignedWorkItemsAsync(projects, unassignedWIs, ct);
        var prTask    = FetchStalePullRequestsAsync(projects, stalePRs, staleDays, ct);
        var uatTask   = uatProject.Length > 0 && uatPipeId > 0
            ? FetchUatStatusAsync(uatProject, uatPipeId, ct)
            : Task.FromResult<UatPipelineStatus?>(null);

        await Task.WhenAll(buildTask, wiTask, prTask, uatTask);
        var uatStatus = await uatTask;

        return new ManagerDigest(
            GeneratedAt:   DateTime.Now,
            FailingBuilds: failingBuilds,
            UnassignedWIs: unassignedWIs,
            StalePRs:      stalePRs,
            UatStatus:     uatStatus
        );
    }

    private async Task FetchFailingBuildsAsync(string[] projects, List<FailingBuildSummary> result, CancellationToken ct)
    {
        foreach (var project in projects)
        {
            try
            {
                var resp = await ado.GetAsync(
                    $"{Uri.EscapeDataString(project)}/_apis/build/builds" +
                    $"?api-version=7.0&$top=100&queryOrder=queueTimeDescending&resultFilter=failed,partiallySucceeded",
                    ct);
                if (!resp.IsSuccessStatusCode)
                {
                    continue;
                }

                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
                // Only keep the most recent run per pipeline definition
                var seen = new HashSet<int>();
                foreach (var b in doc.RootElement.GetProperty("value").EnumerateArray())
                {
                    var defId = b.TryGetProperty("definition", out var def)
                        && def.TryGetProperty("id", out var did) ? did.GetInt32() : 0;
                    if (!seen.Add(defId))
                    {
                        continue;
                    }

                    var buildId = b.TryGetProperty("id", out var bid) ? bid.GetInt32() : 0;
                    result.Add(new FailingBuildSummary(
                        Project:  project,
                        Pipeline: b.TryGetProperty("definition", out var d2) && d2.TryGetProperty("name", out var dn) ? dn.GetString() ?? "" : "",
                        BuildNum: b.TryGetProperty("buildNumber", out var bn) ? bn.GetString() ?? "" : "",
                        Result:   b.TryGetProperty("result",      out var r)  ? r.GetString()  ?? "" : "",
                        Branch:   (b.TryGetProperty("sourceBranch", out var sb) ? sb.GetString() ?? "" : "").Replace("refs/heads/", ""),
                        BuildId:  buildId
                    ));
                }
            }
            catch { }
        }
    }

    private async Task FetchUnassignedWorkItemsAsync(string[] projects, List<UnassignedWorkItemSummary> result, CancellationToken ct)
    {
        foreach (var project in projects)
        {
            try
            {
                var wiqlBody = JsonSerializer.Serialize(new
                {
                    query = "SELECT [System.Id],[System.Title],[System.WorkItemType],[System.State] " +
                            "FROM WorkItems " +
                            "WHERE [System.TeamProject] = @project " +
                            "AND [System.AssignedTo] = '' " +
                            "AND [System.State] NOT IN ('Closed','Done','Resolved','Removed') " +
                            "ORDER BY [System.ChangedDate] DESC"
                });
                var content = new StringContent(wiqlBody, Encoding.UTF8, "application/json");
                var resp    = await ado.PostAsync(
                    $"{Uri.EscapeDataString(project)}/_apis/wit/wiql?api-version=7.0&$top=20", content, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    continue;
                }

                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
                var ids = doc.RootElement.GetProperty("workItems").EnumerateArray()
                    .Take(20).Select(w => w.GetProperty("id").GetInt32()).ToArray();
                if (ids.Length == 0)
                {
                    continue;
                }

                var detailResp = await ado.GetAsync(
                                                    $"_apis/wit/workitems?ids={string.Join(",", ids)}" +
                                                    $"&fields=System.Id,System.Title,System.WorkItemType,System.State&api-version=7.0", ct);
                if (!detailResp.IsSuccessStatusCode)
                {
                    continue;
                }

                using var doc2 = JsonDocument.Parse(await detailResp.Content.ReadAsStringAsync(ct));
                foreach (var wi in doc2.RootElement.GetProperty("value").EnumerateArray())
                {
                    var f = wi.GetProperty("fields");
                    result.Add(new UnassignedWorkItemSummary(
                        Project: project,
                        Id:      wi.GetProperty("id").GetInt32(),
                        Title:   f.Str("System.Title")        ?? "",
                        Type:    f.Str("System.WorkItemType") ?? "",
                        State:   f.Str("System.State")        ?? ""
                    ));
                }
            }
            catch { }
        }
    }

    private async Task FetchStalePullRequestsAsync(string[] projects, List<StalePullRequestSummary> result, int staleDays, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-staleDays);
        foreach (var project in projects)
        {
            try
            {
                var resp = await ado.GetAsync(
                    $"{Uri.EscapeDataString(project)}/_apis/git/pullrequests" +
                    $"?searchCriteria.status=active&$top=200&api-version=7.0", ct);
                if (!resp.IsSuccessStatusCode)
                {
                    continue;
                }

                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
                foreach (var pr in doc.RootElement.GetProperty("value").EnumerateArray())
                {
                    var created = pr.Str("creationDate");
                    if (created == null ||
                        !DateTimeOffset.TryParse(created, out var dt) || dt >= cutoff)
                    {
                        continue;
                    }

                    var author = pr.TryGetProperty("createdBy", out var cb)
                        ? cb.Str("displayName") ?? "" : "";
                    var votes = pr.TryGetProperty("reviewers", out var revs)
                        ? revs.EnumerateArray().Select(r =>
                            r.TryGetProperty("vote", out var v) ? v.GetInt32() : 0).ToArray()
                        : [];

                    result.Add(new StalePullRequestSummary(
                        Project:     project,
                        Id:          pr.TryGetProperty("pullRequestId", out var pid) ? pid.GetInt32() : 0,
                        Title:       pr.Str("title") ?? "",
                        Author:      author,
                        CreatedDate: created,
                        HasApproval: votes.Any(v => v >= 10)
                    ));
                }
            }
            catch { }
        }
    }

    private async Task<UatPipelineStatus?> FetchUatStatusAsync(string project, int pipelineId, CancellationToken ct)
    {
        try
        {
            var resp = await ado.GetAsync(
                $"{Uri.EscapeDataString(project)}/_apis/build/builds" +
                $"?definitions={pipelineId}&$top=1&queryOrder=queueTimeDescending&api-version=7.0", ct);
            if (!resp.IsSuccessStatusCode)
            {
                return null;
            }

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var builds = doc.RootElement.GetProperty("value").EnumerateArray().ToArray();
            if (builds.Length == 0)
            {
                return null;
            }

            var b = builds[0];
            return new UatPipelineStatus(
                BuildNum:   b.Str("buildNumber") ?? "",
                Result:     b.Str("result")      ?? b.Str("status") ?? "",
                FinishTime: b.Str("finishTime")  ?? b.Str("startTime") ?? "",
                Branch:     (b.Str("sourceBranch") ?? "").Replace("refs/heads/", "")
            );
        }
        catch { return null; }
    }

    // ── Email sending ──────────────────────────────────────────────────────────

    public async Task SendEmailAsync(ManagerDigest digest, CancellationToken ct = default)
    {
        var host    = config["Email:SmtpHost"] ?? "";
        var port    = int.TryParse(config["Email:SmtpPort"], out var p) ? p : 587;
        var user    = config["Email:SmtpUser"] ?? "";
        var pass    = config["Email:SmtpPass"] ?? "";
        var from    = config["Email:From"]     ?? user;
        var to      = config["Email:To"]       ?? "";

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(to))
        {
            log.LogWarning("Email not configured — skipping digest send");
            return;
        }

        var html = RenderDigestHtml(digest);
        var subject = $"ADO Dashboard Digest — {digest.GeneratedAt:ddd d MMM} " +
                      $"| {digest.FailingBuilds.Count} failing | {digest.UnassignedWIs.Count} unassigned | {digest.StalePRs.Count} stale PRs";

        using var client = new SmtpClient(host, port)
        {
            EnableSsl       = true,
            Credentials     = new NetworkCredential(user, pass),
            DeliveryMethod  = SmtpDeliveryMethod.Network,
        };
        using var msg = new MailMessage(from, to, subject, html) { IsBodyHtml = true };

        await client.SendMailAsync(msg, ct);
        log.LogInformation("Digest email sent to {To}", to);
    }

    public string BuildHtmlEmail(ManagerDigest digest) => RenderDigestHtml(digest);

    private static string RenderDigestHtml(ManagerDigest d)
    {
        static string Section(string title, string body) =>
            $"<h2 style='color:#1f2937;border-bottom:2px solid #e5e7eb;padding-bottom:6px'>{title}</h2>{body}";

        static string Row(string label, string value) =>
            $"<tr><td style='padding:4px 8px;color:#6b7280;font-size:13px'>{label}</td>" +
            $"<td style='padding:4px 8px;font-size:13px'>{value}</td></tr>";

        var failHtml = d.FailingBuilds.Count == 0
            ? "<p style='color:#059669'>✓ No failing builds</p>"
            : "<table>" + string.Join("", d.FailingBuilds.Select(b =>
                Row($"{b.Project} / {b.Pipeline}", $"<span style='color:#dc2626'>{b.Result}</span> #{b.BuildNum} ({b.Branch})"))) +
              "</table>";

        var wiHtml = d.UnassignedWIs.Count == 0
            ? "<p style='color:#059669'>✓ No unassigned work items</p>"
            : "<table>" + string.Join("", d.UnassignedWIs.Take(20).Select(w =>
                Row($"#{w.Id} [{w.Type}]", $"{w.Title} — <em>{w.State}</em> ({w.Project})"))) +
              "</table>";

        var prHtml = d.StalePRs.Count == 0
            ? "<p style='color:#059669'>✓ No stale PRs</p>"
            : "<table>" + string.Join("", d.StalePRs.Select(pr =>
                Row($"#{pr.Id}", $"{pr.Title} by {pr.Author} — {(pr.HasApproval ? "approved" : "no approval")}"))) +
              "</table>";

        var uatHtml = d.UatStatus == null ? "<p>UAT pipeline not configured.</p>"
            : $"<p>Build <strong>{d.UatStatus.BuildNum}</strong> ({d.UatStatus.Branch}) — " +
              $"<span style='color:{(d.UatStatus.Result=="succeeded"?"#059669":"#dc2626")}'>{d.UatStatus.Result}</span>" +
              $" at {d.UatStatus.FinishTime}</p>";

        return $"""
            <html><body style='font-family:sans-serif;max-width:700px;margin:auto;color:#1f2937'>
            <h1 style='background:#0078d4;color:#fff;padding:16px 20px;border-radius:6px;font-size:18px'>
              ADO Dashboard — Daily Digest<br>
              <span style='font-size:13px;font-weight:400'>{d.GeneratedAt:dddd d MMMM yyyy, HH:mm}</span>
            </h1>
            {Section($"🏗️ Failing Builds ({d.FailingBuilds.Count})", failHtml)}
            {Section($"📋 Unassigned Work Items ({d.UnassignedWIs.Count})", wiHtml)}
            {Section($"🔀 Stale PRs — no activity in 3+ days ({d.StalePRs.Count})", prHtml)}
            {Section("🚀 UAT Status", uatHtml)}
            <p style='color:#9ca3af;font-size:11px;margin-top:24px'>ADO Dashboard — {d.GeneratedAt:O}</p>
            </body></html>
            """;
    }
}

// ── Data models ────────────────────────────────────────────────────────────────

public record ManagerDigest(
    DateTime          GeneratedAt,
    List<FailingBuildSummary> FailingBuilds,
    List<UnassignedWorkItemSummary>    UnassignedWIs,
    List<StalePullRequestSummary>    StalePRs,
    UatPipelineStatus?        UatStatus);

public record FailingBuildSummary(string Project, string Pipeline, string BuildNum, string Result, string Branch, int BuildId = 0);
public record UnassignedWorkItemSummary(string Project, int Id, string Title, string Type, string State);
public record StalePullRequestSummary(string Project, int Id, string Title, string Author, string CreatedDate, bool HasApproval);
public record UatPipelineStatus(string BuildNum, string Result, string FinishTime, string Branch);