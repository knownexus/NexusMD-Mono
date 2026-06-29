namespace NexusMDWeb.Api.Models;

public record Profile(
    string  Id,
    string  Name,
    string  Initials,
    string  Color,
    string  Type,        // "ado" | "github" | "manual"
    string? Config,      // JSON blob of type-specific settings
    long    CreatedAt    // Unix ms
);
