import type { ServerStatus } from '@shared/contracts/serverStatus';

export const writeVarInt = (value: number): Buffer => {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  while (true) {
    if ((remaining & ~0x7f) === 0) {
      bytes.push(remaining);
      return Buffer.from(bytes);
    }
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
};

export const readVarInt = (
  buffer: Buffer,
  offset: number,
): { value: number; offset: number } | null => {
  let value = 0;
  let position = 0;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === undefined) return null;
    cursor += 1;
    value |= (byte & 0x7f) << position;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    position += 7;
    if (position >= 32) return null;
  }
  return null;
};

export const componentToString = (component: unknown): string => {
  if (typeof component === 'string') return component;
  if (Array.isArray(component)) return component.map(componentToString).join('');
  if (component && typeof component === 'object') {
    const node = component as { text?: unknown; extra?: unknown };
    let out = typeof node.text === 'string' ? node.text : '';
    if (Array.isArray(node.extra)) out += node.extra.map(componentToString).join('');
    return out;
  }
  return '';
};

export const motdToCleanLines = (description: unknown): string[] =>
  componentToString(description)
    .replace(/§./g, '')
    .split('\n')
    .filter((line) => line.length > 0);

export const tryParseStatusResponse = (buffer: Buffer): ServerStatus | null | 'incomplete' => {
  const lengthRead = readVarInt(buffer, 0);
  if (!lengthRead) return 'incomplete';
  const totalLength = lengthRead.value;
  const bodyStart = lengthRead.offset;
  if (buffer.length - bodyStart < totalLength) return 'incomplete';

  const body = buffer.subarray(bodyStart, bodyStart + totalLength);
  const idRead = readVarInt(body, 0);
  if (!idRead || idRead.value !== 0x00) return null;

  const strLenRead = readVarInt(body, idRead.offset);
  if (!strLenRead) return null;
  const json = body
    .subarray(strLenRead.offset, strLenRead.offset + strLenRead.value)
    .toString('utf8');

  try {
    const data = JSON.parse(json) as {
      players?: { online?: number; max?: number };
      description?: unknown;
    };
    const players =
      data.players &&
      typeof data.players.online === 'number' &&
      typeof data.players.max === 'number'
        ? { online: data.players.online, max: data.players.max }
        : null;
    return {
      online: true,
      ...(players ? { players } : {}),
      motd: { clean: motdToCleanLines(data.description) },
    };
  } catch {
    return null;
  }
};

export const buildHandshakeFrame = (host: string, port: number): Buffer => {
  const hostBuf = Buffer.from(host, 'utf8');
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  const handshake = Buffer.concat([
    writeVarInt(0x00),
    writeVarInt(-1),
    writeVarInt(hostBuf.length),
    hostBuf,
    portBuf,
    writeVarInt(1),
  ]);
  return Buffer.concat([writeVarInt(handshake.length), handshake]);
};

export const buildStatusRequestFrame = (): Buffer => {
  const statusRequest = writeVarInt(0x00);
  return Buffer.concat([writeVarInt(statusRequest.length), statusRequest]);
};
