using System.Globalization;
using System.Text;
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
    public record BatchItem(string? Id, long? IfMatch, string? Ciphertext, bool Deleted);
    public record BatchRequest(List<BatchItem?>? Items);

    // PUT /api/items/{id} { ciphertext, deleted } + If-Match: <revision> (0 = create) -> { revision, cursor } | 400 | 409 | 413
    [HttpPut("{id}")]
    [ItemBodyLimit(batch: false)]
    public IActionResult Put(string id, [FromBody] PutItemRequest? req)
    {
        if (!IsValidId(id)) return Err(400, $"id must be 1-{MaxIdChars} characters of A-Z a-z 0-9 _ -");
        if (!DevicesController.TryReadIfMatch(Request, out var ifMatch)) return Err(400, "If-Match must be the current revision (a non-negative integer, 0 to create)");
        if (string.IsNullOrEmpty(req?.Ciphertext)) return Err(400, "ciphertext is required");
        if (Encoding.UTF8.GetByteCount(req.Ciphertext) > ItemLimits.MaxBytes(config)) return Err(413, "ciphertext is too large");

        var result = accounts.WriteItem(CallerId(), new ItemWrite(id, ifMatch, req.Ciphertext, req.Deleted));
        if (result.Status != WriteStatus.Ok)
            return StatusCode(StatusCodes.Status409Conflict, new { error = "revision conflict", code = "conflict" });
        return Ok(new { revision = result.Revision, cursor = result.Cursor });
    }

    // POST /api/items/batch { items:[{ id, ifMatch, ciphertext, deleted }] } (max 100)
    //   -> { results:[{ id, status: ok|conflict|too_large|invalid, revision, cursor }] }, one result per item in order.
    // Items are independent: a conflict or invalid item never rolls back or blocks the others.
    [HttpPost("batch")]
    [ItemBodyLimit(batch: true)]
    public IActionResult Batch([FromBody] BatchRequest? req)
    {
        if (req?.Items is null) return Err(400, "items is required");
        if (req.Items.Count > MaxBatchItems) return Err(400, $"at most {MaxBatchItems} items per batch");

        var maxBytes = ItemLimits.MaxBytes(config);
        var statuses = new string[req.Items.Count];
        var toWrite = new List<ItemWrite>(req.Items.Count);
        var writeIndex = new List<int>(req.Items.Count);
        for (var i = 0; i < req.Items.Count; i++)
        {
            var it = req.Items[i];
            if (it is null || !IsValidId(it.Id) || it.IfMatch is null or < 0 || string.IsNullOrEmpty(it.Ciphertext))
                statuses[i] = "invalid";
            else if (Encoding.UTF8.GetByteCount(it.Ciphertext) > maxBytes)
                statuses[i] = "too_large";
            else
            {
                statuses[i] = "ok"; // provisional: conflicts are filled in below
                toWrite.Add(new ItemWrite(it.Id!, it.IfMatch.Value, it.Ciphertext, it.Deleted));
                writeIndex.Add(i);
            }
        }

        var written = accounts.WriteItems(CallerId(), toWrite);
        var results = new object[req.Items.Count];
        var byIndex = new Dictionary<int, WriteResult>();
        for (var k = 0; k < written.Count; k++) byIndex[writeIndex[k]] = written[k];
        for (var i = 0; i < results.Length; i++)
        {
            var echoId = Echo(req.Items[i]?.Id);
            if (byIndex.TryGetValue(i, out var w))
                results[i] = w.Status == WriteStatus.Ok
                    ? new { id = echoId, status = "ok", revision = w.Revision, cursor = w.Cursor }
                    : new { id = echoId, status = "conflict", revision = 0L, cursor = 0L };
            else
                results[i] = new { id = echoId, status = statuses[i], revision = 0L, cursor = 0L };
        }
        log.LogInformation("User {UserId} batch of {Count} items: {Written} written", CallerId(), req.Items.Count,
            written.Count(w => w.Status == WriteStatus.Ok));
        return Ok(new { results });
    }

    // GET /api/items/changes?since=<cursor>&limit=500 -> { items:[{ id, revision, cursor, ciphertext, deleted, updatedAt }], cursor }
    // cursor is the highest cursor in the page (or `since` when empty). Page by repeating until fewer than `limit` come back.
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
            if (!(limit is { Length: > 0 and <= 18 }
                  && long.TryParse(limit, NumberStyles.None, CultureInfo.InvariantCulture, out var l) && l >= 1))
                return Err(400, "limit must be a positive integer");
            take = (int)Math.Min(l, MaxChangesLimit);
        }

        var rows = accounts.GetItemChanges(CallerId(), sinceCursor, take);
        var cursor = rows.Count > 0 ? rows[^1].Cursor : sinceCursor;
        return Ok(new
        {
            items = rows.Select(r => new
            {
                id = r.Id, revision = r.Revision, cursor = r.Cursor, ciphertext = r.Ciphertext,
                deleted = r.Deleted, updatedAt = r.UpdatedAt,
            }),
            cursor,
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

    // Item ids are not secret-bearing but are client-supplied; bound what we reflect back.
    private static string Echo(string? id) => id is null ? "" : id.Length <= MaxIdChars ? id : id[..MaxIdChars];
}
