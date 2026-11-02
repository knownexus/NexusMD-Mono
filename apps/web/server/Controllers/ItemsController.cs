using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Data;
using NexusMDWeb.Api.Models;
using NexusMDWeb.Api.Services.Auth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// The caller's end-to-end encrypted item store. The server never sees plaintext: an item is an opaque
/// client-chosen id (base64url HMAC output) plus an opaque ciphertext, with a server-managed revision for
/// optimistic concurrency and a per-user monotonic cursor that drives the changes feed. A deleted item is a
/// tombstone that keeps its (client-encrypted) ciphertext and can be revived by writing it again. Ciphertext
/// and item ids are never logged. Everything is scoped to the user in the token's <c>sub</c> claim.
///
/// Contract (pinned):
///  - <c>updatedAt</c> is Unix milliseconds (UTC) everywhere in this controller.
///  - Item statuses in a batch result are exactly: ok | conflict | too_large | invalid | quota.
///  - Single PUT: 409 {code:"conflict"} stale revision; 413 {code:"too_large"} over Items:MaxBytes;
///    413 {code:"quota"} over the per-user Items:MaxUserBytes.
///  - The changes feed is paged by BOTH a row limit and a byte budget (Items:MaxPageBytes), so a page may hold
///    fewer rows than <c>limit</c>; clients must keep paging while <c>hasMore</c> is true, never by counting rows.
/// </summary>
[ApiController]
[Route("api/items")]
[Authorize] // any role; fail closed
[LiveUserCheck]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class ItemsController(AccountRepository accounts, IConfiguration config, ILogger<ItemsController> log) : ControllerBase
{
    public const int MaxIdChars = 128;
    public const int MaxBatchItems = 100;
    public const int DefaultChangesLimit = 500;
    public const int MaxChangesLimit = 1000;

    public record PutItemRequest(string? Ciphertext, bool Deleted);

    /// <summary>Items are bound as raw JSON so one badly typed entry marks only itself "invalid" instead of failing the batch.</summary>
    public record BatchRequest(List<JsonElement>? Items);

    // PUT /api/items/{id} { ciphertext, deleted } + If-Match: <revision> (0 = create) -> { revision, cursor } | 400 | 409 | 413
    [HttpPut("{id}")]
    [ItemBodyLimit(batch: false)]
    public IActionResult Put(string id, [FromBody] PutItemRequest? req)
    {
        if (!IsValidId(id)) return Err(400, $"id must be 1-{MaxIdChars} characters of A-Z a-z 0-9 _ -");
        if (!DevicesController.TryReadIfMatch(Request, out var ifMatch)) return Err(400, "If-Match must be the current revision (a non-negative integer, 0 to create)");
        if (string.IsNullOrEmpty(req?.Ciphertext)) return Err(400, "ciphertext is required");
        if (Encoding.UTF8.GetByteCount(req.Ciphertext) > ItemLimits.MaxBytes(config))
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "ciphertext is too large", code = "too_large" });

        var result = accounts.WriteItem(CallerId(), new ItemWrite(id, ifMatch, req.Ciphertext, req.Deleted), ItemLimits.MaxUserBytes(config));
        switch (result.Status)
        {
            case WriteStatus.Ok: return Ok(new { revision = result.Revision, cursor = result.Cursor });
            case WriteStatus.Quota:
                return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = "storage quota exceeded", code = "quota" });
            default:
                return StatusCode(StatusCodes.Status409Conflict, new { error = "revision conflict", code = "conflict" });
        }
    }

    // POST /api/items/batch { items:[{ id, ifMatch, ciphertext, deleted }] } (max 100)
    //   -> { results:[{ id, status: ok|conflict|too_large|invalid|quota, revision, cursor }] }, one result per item in order.
    // Items are independent: a conflict, quota or invalid item never rolls back or blocks the others.
    // A body that is not an object with an `items` array is a 400.
    [HttpPost("batch")]
    [ItemBodyLimit(batch: true)]
    public IActionResult Batch([FromBody] BatchRequest? req)
    {
        if (req?.Items is null) return Err(400, "items is required");
        if (req.Items.Count > MaxBatchItems) return Err(400, $"at most {MaxBatchItems} items per batch");

        var maxBytes = ItemLimits.MaxBytes(config);
        var count = req.Items.Count;
        var ids = new string[count];
        var statuses = new string[count];
        var toWrite = new List<ItemWrite>(count);
        var writeIndex = new List<int>(count);
        for (var i = 0; i < count; i++)
        {
            ids[i] = EchoId(req.Items[i]);
            if (!TryParseItem(req.Items[i], out var write)) statuses[i] = "invalid";
            else if (Encoding.UTF8.GetByteCount(write.Ciphertext) > maxBytes) statuses[i] = "too_large";
            else
            {
                statuses[i] = "ok"; // provisional: conflicts and quota rejections are filled in below
                toWrite.Add(write);
                writeIndex.Add(i);
            }
        }

        var written = accounts.WriteItems(CallerId(), toWrite, ItemLimits.MaxUserBytes(config));
        var results = new object[count];
        var byIndex = new Dictionary<int, WriteResult>();
        for (var k = 0; k < written.Count; k++) byIndex[writeIndex[k]] = written[k];
        for (var i = 0; i < count; i++)
        {
            if (byIndex.TryGetValue(i, out var w))
                results[i] = w.Status switch
                {
                    WriteStatus.Ok => new { id = ids[i], status = "ok", revision = w.Revision, cursor = w.Cursor },
                    WriteStatus.Quota => new { id = ids[i], status = "quota", revision = 0L, cursor = 0L },
                    _ => new { id = ids[i], status = "conflict", revision = 0L, cursor = 0L },
                };
            else
                results[i] = new { id = ids[i], status = statuses[i], revision = 0L, cursor = 0L };
        }
        log.LogInformation("User {UserId} batch of {Count} items: {Written} written", CallerId(), count,
            written.Count(w => w.Status == WriteStatus.Ok));
        return Ok(new { results });
    }

    // GET /api/items/changes?since=<cursor>&limit=500 -> { items:[{ id, revision, cursor, ciphertext, deleted, updatedAt }], cursor, hasMore }
    // A page holds at most `limit` rows (default 500, values above 1000 clamp to 1000) and at most
    // Items:MaxPageBytes of ciphertext (always at least one row). `cursor` is the highest cursor in the page, or
    // `since` when the page is empty. `hasMore` is true when more rows exist beyond this page, whichever limit
    // cut it: clients repeat with since=cursor WHILE hasMore is true (a short page does not mean the end).
    [HttpGet("changes")]
    public IActionResult Changes([FromQuery] string? since, [FromQuery] string? limit)
    {
        long sinceCursor = 0;
        if (Request.Query.ContainsKey("since")
            && !(since is { Length: > 0 and <= 18 }
                 && long.TryParse(since, NumberStyles.None, CultureInfo.InvariantCulture, out sinceCursor)))
            return Err(400, "since must be a non-negative integer");

        var take = DefaultChangesLimit;
        if (Request.Query.ContainsKey("limit"))
        {
            // Any run of ASCII digits is a non-negative integer, however long: huge values clamp to the maximum.
            if (string.IsNullOrEmpty(limit) || !limit.All(char.IsAsciiDigit)) return Err(400, "limit must be a positive integer");
            var trimmed = limit.TrimStart('0');
            if (trimmed.Length == 0) return Err(400, "limit must be a positive integer");
            take = trimmed.Length > 6 ? MaxChangesLimit : (int)Math.Min(int.Parse(trimmed, CultureInfo.InvariantCulture), MaxChangesLimit);
        }

        var (rows, hasMore) = accounts.GetItemChanges(CallerId(), sinceCursor, take, ItemLimits.MaxPageBytes(config));
        var cursor = rows.Count > 0 ? rows[^1].Cursor : sinceCursor;
        return Ok(new
        {
            items = rows.Select(r => new
            {
                id = r.Id, revision = r.Revision, cursor = r.Cursor, ciphertext = r.Ciphertext,
                deleted = r.Deleted, updatedAt = r.UpdatedAt,
            }),
            cursor,
            hasMore,
        });
    }

    // ---- helpers -----------------------------------------------------------------------

    private string CallerId() => User.FindFirst("sub")?.Value ?? "";

    private IActionResult Err(int status, string message) => StatusCode(status, new { error = message });

    /// <summary>Item ids are opaque base64url strings (HMAC output): 1-128 characters of [A-Za-z0-9_-].</summary>
    internal static bool IsValidId(string? id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > MaxIdChars) return false;
        foreach (var c in id)
            if (!(c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')) return false;
        return true;
    }

    /// <summary>
    /// Strictly typed read of one batch entry: an object with a valid string id, a non-negative integer ifMatch,
    /// a non-empty string ciphertext and (when present) a boolean deleted. Anything else is not parsed.
    /// </summary>
    private static bool TryParseItem(JsonElement el, out ItemWrite write)
    {
        write = null!;
        if (el.ValueKind != JsonValueKind.Object) return false;
        if (!el.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String || !IsValidId(id.GetString())) return false;
        if (!el.TryGetProperty("ifMatch", out var im) || im.ValueKind != JsonValueKind.Number
            || !im.TryGetInt64(out var ifMatch) || ifMatch < 0) return false;
        if (!el.TryGetProperty("ciphertext", out var ct) || ct.ValueKind != JsonValueKind.String) return false;
        var ciphertext = ct.GetString();
        if (string.IsNullOrEmpty(ciphertext)) return false;
        var deleted = false;
        if (el.TryGetProperty("deleted", out var del))
        {
            if (del.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
            deleted = del.GetBoolean();
        }
        write = new ItemWrite(id.GetString()!, ifMatch, ciphertext, deleted);
        return true;
    }

    // Client-supplied, so bound what is reflected back: the id when it is a string (truncated), else empty.
    private static string EchoId(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) return "";
        var s = id.GetString() ?? "";
        return s.Length <= MaxIdChars ? s : s[..MaxIdChars];
    }
}
