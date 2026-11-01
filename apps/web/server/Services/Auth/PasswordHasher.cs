using System.Security.Cryptography;

namespace NexusMDWeb.Api.Services.Auth;

/// <summary>
/// Server-side hash of the client's auth key (itself already a PBKDF2/HKDF derivative of the
/// password). Stored format: <c>iterations.saltBase64.hashBase64</c>, PBKDF2-SHA256 with a
/// per-hash random salt. The server never stores the auth key or any vault key.
/// </summary>
public static class PasswordHasher
{
    public const int Iterations = 210_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    public static string Hash(byte[] authKey)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(authKey, salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(byte[] authKey, string stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;
        var parts = stored.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var iterations) || iterations < 1) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[1]);
            var expected = Convert.FromBase64String(parts[2]);
            if (expected.Length == 0) return false;
            var actual = Rfc2898DeriveBytes.Pbkdf2(authKey, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
