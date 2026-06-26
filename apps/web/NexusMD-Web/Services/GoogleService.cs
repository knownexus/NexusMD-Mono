using Microsoft.Extensions.Caching.Memory;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace NexusMDWeb.Api.Services;

// ── DTOs ─────────────────────────────────────────────────────────────────────

public record GoogleCalendarEvent(
    string Id, string Title, string Start, string End,
    bool IsAllDay, string? Location, string Url);

public record GmailMessage(
    string Id, string Subject, string From, string Date,
    string Snippet, string ThreadUrl);

public record DriveFile(string Id, string Name, string ModifiedTime, string Size);

public record PlannerDriveFile(string Id, string Name, string ModifiedTime, int Version);

// ── Service ───────────────────────────────────────────────────────────────────

public class GoogleService(HttpClient http, IMemoryCache cache)
{
    // ── Calendar ──────────────────────────────────────────────────────────────

    private int CalGen(string token)
        => cache.TryGetValue($"google:cal:gen:{token.GetHashCode()}", out int g) ? g : 0;

    private void InvalidateCalCache(string token)
    {
        var gk = $"google:cal:gen:{token.GetHashCode()}";
        cache.TryGetValue(gk, out int g);
        cache.Set(gk, g + 1, TimeSpan.FromHours(1));
    }

    public async Task<(IReadOnlyList<GoogleCalendarEvent> Events, string? Error)> GetCalendarEventsAsync(
        string token, DateTime start, DateTime end, CancellationToken ct)
    {
        var key = $"google:cal:{token.GetHashCode()}:{CalGen(token)}:{start:yyyyMMdd}:{end:yyyyMMdd}";
        if (cache.TryGetValue(key, out IReadOnlyList<GoogleCalendarEvent>? cached)) return (cached!, null);

        var timeMin = Uri.EscapeDataString(start.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        var timeMax = Uri.EscapeDataString(end.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        var path    = $"calendar/v3/calendars/primary/events?timeMin={timeMin}&timeMax={timeMax}&singleEvents=true&orderBy=startTime";

        using var req = BuildRequest(HttpMethod.Get, path, token);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            string msg;
            try
            {
                using var errDoc = JsonDocument.Parse(body);
                msg = errDoc.RootElement.TryGetProperty("error", out var err) &&
                      err.TryGetProperty("message", out var m) ? m.GetString() ?? body : body;
            }
            catch { msg = body; }
            return ([], $"Google Calendar API error {(int)res.StatusCode}: {msg}");
        }

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var events = doc.RootElement.TryGetProperty("items", out var items)
            ? items.EnumerateArray().Select(e =>
            {
                var startEl  = e.TryGetProperty("start", out var s)  ? s  : default;
                var endEl    = e.TryGetProperty("end",   out var en) ? en : default;
                var isAllDay = startEl.ValueKind != JsonValueKind.Undefined && startEl.TryGetProperty("date", out _);
                var startStr = isAllDay
                    ? (startEl.TryGetProperty("date",     out var sd)  ? sd.GetString()  ?? "" : "")
                    : (startEl.TryGetProperty("dateTime", out var sdt) ? sdt.GetString() ?? "" : "");
                var endStr   = isAllDay
                    ? (endEl.ValueKind != JsonValueKind.Undefined && endEl.TryGetProperty("date",     out var ed)  ? ed.GetString()  ?? "" : "")
                    : (endEl.ValueKind != JsonValueKind.Undefined && endEl.TryGetProperty("dateTime", out var edt) ? edt.GetString() ?? "" : "");
                return new GoogleCalendarEvent(
                    Id:       e.GetProperty("id").GetString() ?? "",
                    Title:    e.TryGetProperty("summary",  out var sum)  ? sum.GetString()  ?? "(no title)" : "(no title)",
                    Start:    startStr,
                    End:      endStr,
                    IsAllDay: isAllDay,
                    Location: e.TryGetProperty("location", out var loc) ? loc.GetString() : null,
                    Url:      e.TryGetProperty("htmlLink", out var link) ? link.GetString() ?? "" : "");
            }).ToList()
            : [];

        cache.Set(key, (IReadOnlyList<GoogleCalendarEvent>)events, TimeSpan.FromSeconds(30));
        return (events, null);
    }

    public async Task<bool> CreateCalendarEventAsync(
        string token, string title, DateTime start, DateTime end, string? description, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new
        {
            summary     = title,
            description = description,
            start       = new { dateTime = start.ToString("yyyy-MM-ddTHH:mm:ss"), timeZone = "UTC" },
            end         = new { dateTime = end.ToString("yyyy-MM-ddTHH:mm:ss"),   timeZone = "UTC" },
        });
        using var req = BuildRequest(HttpMethod.Post, "calendar/v3/calendars/primary/events", token);
        req.Content  = new StringContent(body, Encoding.UTF8, "application/json");
        var res = await http.SendAsync(req, ct);
        if (res.IsSuccessStatusCode) InvalidateCalCache(token);
        return res.IsSuccessStatusCode;
    }

    // ── Gmail ─────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<GmailMessage>> GetGmailDigestAsync(string token, CancellationToken ct)
    {
        var key = $"google:gmail:{token.GetHashCode()}";
        if (cache.TryGetValue(key, out IReadOnlyList<GmailMessage>? cached)) return cached!;

        using var listReq = BuildRequest(HttpMethod.Get, "gmail/v1/users/me/messages?labelIds=INBOX&maxResults=50", token);
        var listRes = await http.SendAsync(listReq, ct);
        if (!listRes.IsSuccessStatusCode) return [];

        using var listDoc = JsonDocument.Parse(await listRes.Content.ReadAsStringAsync(ct));
        if (!listDoc.RootElement.TryGetProperty("messages", out var msgs)) return [];

        var ids   = msgs.EnumerateArray().Select(m => m.GetProperty("id").GetString() ?? "").Where(id => id.Length > 0).Take(10).ToList();
        var tasks = ids.Select(id => FetchMessageMetadata(token, id, ct)).ToArray();
        var details = (await Task.WhenAll(tasks)).Where(m => m is not null).Cast<GmailMessage>().ToList();

        cache.Set(key, (IReadOnlyList<GmailMessage>)details, TimeSpan.FromMinutes(5));
        return details;
    }

    private async Task<GmailMessage?> FetchMessageMetadata(string token, string id, CancellationToken ct)
    {
        try
        {
            var path = $"gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date";
            using var req = BuildRequest(HttpMethod.Get, path, token);
            var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;

            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            var headers = doc.RootElement.TryGetProperty("payload", out var p) && p.TryGetProperty("headers", out var h)
                ? h.EnumerateArray().ToDictionary(
                    x => x.GetProperty("name").GetString() ?? "",
                    x => x.GetProperty("value").GetString() ?? "")
                : new Dictionary<string, string>();

            var snippet  = doc.RootElement.TryGetProperty("snippet",  out var s)   ? s.GetString() ?? ""   : "";
            var threadId = doc.RootElement.TryGetProperty("threadId", out var tid) ? tid.GetString() ?? "" : "";

            return new GmailMessage(
                Id:        id,
                Subject:   headers.GetValueOrDefault("Subject", "(no subject)"),
                From:      headers.GetValueOrDefault("From", ""),
                Date:      headers.GetValueOrDefault("Date", ""),
                Snippet:   snippet,
                ThreadUrl: $"https://mail.google.com/mail/u/0/#inbox/{threadId}");
        }
        catch { return null; }
    }

    public async Task<bool> SendGmailAsync(string token, string to, string subject, string htmlBody, CancellationToken ct)
    {
        var raw     = $"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{htmlBody}";
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(raw)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var body    = JsonSerializer.Serialize(new { raw = encoded });
        using var req = BuildRequest(HttpMethod.Post, "gmail/v1/users/me/messages/send", token);
        req.Content  = new StringContent(body, Encoding.UTF8, "application/json");
        var res = await http.SendAsync(req, ct);
        return res.IsSuccessStatusCode;
    }

    // ── Drive ─────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DriveFile>> ListDriveBackupsAsync(string token, CancellationToken ct)
    {
        var key = $"google:drive:{token.GetHashCode()}";
        if (cache.TryGetValue(key, out IReadOnlyList<DriveFile>? cached)) return cached!;

        var path = "drive/v3/files?spaces=appDataFolder&fields=files(id%2Cname%2CmodifiedTime%2Csize)&orderBy=modifiedTime%20desc";
        using var req = BuildRequest(HttpMethod.Get, path, token);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var files = doc.RootElement.TryGetProperty("files", out var f)
            ? f.EnumerateArray().Select(file => new DriveFile(
                file.GetProperty("id").GetString() ?? "",
                file.GetProperty("name").GetString() ?? "",
                file.TryGetProperty("modifiedTime", out var mt) ? mt.GetString() ?? "" : "",
                file.TryGetProperty("size", out var sz) ? sz.GetString() ?? "0" : "0")).ToList()
            : [];

        cache.Set(key, (IReadOnlyList<DriveFile>)files, TimeSpan.FromMinutes(1));
        return files;
    }

    public async Task<IReadOnlyList<PlannerDriveFile>> ListPlannerFilesAsync(string token, string profileId, CancellationToken ct)
    {
        var nameFilter = Uri.EscapeDataString($"name contains 'planner-{profileId}-'");
        var fields     = Uri.EscapeDataString("files(id,name,modifiedTime,appProperties)");
        var path = $"drive/v3/files?spaces=appDataFolder&q={nameFilter}&fields={fields}&orderBy=modifiedTime%20desc";

        using var req = BuildRequest(HttpMethod.Get, path, token);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return [];

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("files", out var f)
            ? f.EnumerateArray().Select(file =>
            {
                var versionStr = file.TryGetProperty("appProperties", out var ap) &&
                                 ap.TryGetProperty("version", out var v) ? v.GetString() ?? "0" : "0";
                return new PlannerDriveFile(
                    file.GetProperty("id").GetString() ?? "",
                    file.GetProperty("name").GetString() ?? "",
                    file.TryGetProperty("modifiedTime", out var mt) ? mt.GetString() ?? "" : "",
                    int.TryParse(versionStr, out var ver) ? ver : 0);
            }).ToList()
            : [];
    }

    public async Task<string?> UpsertPlannerFileAsync(
        string token, string fileName, string jsonContent, int version, string? existingFileId, CancellationToken ct)
    {
        var metadata = existingFileId is null
            ? JsonSerializer.Serialize(new
            {
                name          = fileName,
                parents       = new[] { "appDataFolder" },
                appProperties = new { version = version.ToString() },
            })
            : JsonSerializer.Serialize(new
            {
                name          = fileName,
                appProperties = new { version = version.ToString() },
            });
        var boundary  = "planner_sync_boundary";
        var multipart = $"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{jsonContent}\r\n--{boundary}--";

        var method = existingFileId is null ? HttpMethod.Post : HttpMethod.Patch;
        var url    = existingFileId is null
            ? "upload/drive/v3/files?uploadType=multipart"
            : $"upload/drive/v3/files/{existingFileId}?uploadType=multipart";

        using var req   = BuildRequest(method, url, token);
        var bodyBytes   = Encoding.UTF8.GetBytes(multipart);
        req.Content     = new ByteArrayContent(bodyBytes);
        req.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse($"multipart/related; boundary={boundary}");
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : existingFileId;
    }

    public Task<string?> DownloadPlannerFileAsync(string token, string fileId, CancellationToken ct)
        => DownloadDriveBackupAsync(token, fileId, ct);

    public async Task<string?> UploadDriveBackupAsync(string token, string fileName, string jsonContent, CancellationToken ct)
    {
        var metadata  = JsonSerializer.Serialize(new { name = fileName, parents = new[] { "appDataFolder" } });
        var boundary  = "backup_boundary";
        var multipart = $"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{jsonContent}\r\n--{boundary}--";

        using var req   = BuildRequest(HttpMethod.Post, "upload/drive/v3/files?uploadType=multipart", token);
        var bodyBytes   = Encoding.UTF8.GetBytes(multipart);
        req.Content     = new ByteArrayContent(bodyBytes);
        req.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse($"multipart/related; boundary={boundary}");
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : null;
    }

    public async Task<string?> DownloadDriveBackupAsync(string token, string fileId, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, $"drive/v3/files/{fileId}?alt=media", token);
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadAsStringAsync(ct);
    }

    public async Task<bool> DeleteCalendarEventAsync(string token, string eventId, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Delete, $"calendar/v3/calendars/primary/events/{Uri.EscapeDataString(eventId)}", token);
        var res = await http.SendAsync(req, ct);
        var ok = res.IsSuccessStatusCode || res.StatusCode == System.Net.HttpStatusCode.Gone;
        if (ok) InvalidateCalCache(token);
        return ok;
    }

    public async Task DeleteDriveFileAsync(string token, string fileId, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Delete, $"drive/v3/files/{fileId}", token);
        await http.SendAsync(req, ct);
    }

    // ── OAuth ─────────────────────────────────────────────────────────────────

    public string BuildAuthUrl(string clientId, string redirectUri)
    {
        var scopes = Uri.EscapeDataString("https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.appdata");
        return $"https://accounts.google.com/o/oauth2/v2/auth?client_id={Uri.EscapeDataString(clientId)}&redirect_uri={Uri.EscapeDataString(redirectUri)}&response_type=code&scope={scopes}&access_type=offline&prompt=consent";
    }

    public async Task<(string? AccessToken, string? RefreshToken)> ExchangeCodeAsync(
        string code, string clientId, string clientSecret, string redirectUri, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"]          = code,
                ["client_id"]     = clientId,
                ["client_secret"] = clientSecret,
                ["redirect_uri"]  = redirectUri,
                ["grant_type"]    = "authorization_code",
            })
        };
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return (null, null);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var access  = doc.RootElement.TryGetProperty("access_token",  out var a) ? a.GetString() : null;
        var refresh = doc.RootElement.TryGetProperty("refresh_token", out var r) ? r.GetString() : null;
        return (access, refresh);
    }

    public async Task<string?> RefreshAccessTokenAsync(
        string refreshToken, string clientId, string clientSecret, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["refresh_token"] = refreshToken,
                ["client_id"]     = clientId,
                ["client_secret"] = clientSecret,
                ["grant_type"]    = "refresh_token",
            })
        };
        var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("access_token", out var a) ? a.GetString() : null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static HttpRequestMessage BuildRequest(HttpMethod method, string path, string token)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }
}