import { Mina } from "o1js";
import { networks, type NetworkId } from "@zkroll/shared";

export function createMinaNetwork(networkId: NetworkId): ReturnType<typeof Mina.Network> {
  const config = networks[networkId];

  return Mina.Network({
    networkId: config.networkId as Parameters<typeof Mina.Network>[0] extends { networkId?: infer T } ? T : never,
    mina: config.minaEndpoint,
    archive: config.archiveEndpoint
  });
}
