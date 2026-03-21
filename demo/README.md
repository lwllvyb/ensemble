# Vulnerable API Demo

**This is an intentionally insecure API for demo purposes only.**

Used to demonstrate ensemble's `/collab` security review capability. The agents will find these vulnerabilities:

- SQL injection in every database query
- Hardcoded API keys and secrets
- JWT tokens without expiration
- Sensitive data in JWT payload (SSN)
- No authentication on destructive endpoints
- No input validation
- No rate limiting or CORS
- Plaintext password storage
- Password hashes exposed in API responses
- Security by obscurity on admin endpoint

**Do not deploy this anywhere. It exists only as a demo target.**
