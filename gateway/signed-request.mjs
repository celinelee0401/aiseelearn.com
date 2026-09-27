import { createHash, createHmac } from "node:crypto";

export function signGatewayRequest(request, options) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(request), "utf8")
    .digest("hex");
  return createHmac("sha256", options.secret)
    .update(`v1\n${options.sentAt}\n${options.nonce}\n${requestHash}`, "utf8")
    .digest("base64url");
}

export function buildSignedGatewayRequest(request, options) {
  return {
    gateway: {
      version: "1",
      sentAt: options.sentAt,
      nonce: options.nonce,
      signature: signGatewayRequest(request, options)
    },
    request
  };
}
