export enum KairoInitEventId {
    SessionRequest = "kairo:session-request",
    SessionResponse = "kairo:session-response",
    ElectionAnnounce = "kairo:bootstrap-election-announce",
    DiscoveryQuery = "kairo:discovery_query",
    DiscoveryResponse = "kairo:discovery_response",
    RegistrationRequest = "kairo:registration_request",
    RegistrationResponse = "kairo:registration_response",
    RegistrationResult = "kairo:registration_result",
    OrderPing = "kairo:order-ping",
    OrderPong = "kairo:order-pong",
    ApiManifest = "kairo:api_manifest",
}
