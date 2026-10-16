Test-only TLS fixtures (fake company CA + a localhost server certificate it
signed) used by the integration tests to reproduce
SELF_SIGNED_CERT_IN_CHAIN. Not used by the app. The CA's private key was
discarded after signing.
