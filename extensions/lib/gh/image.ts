/**
 * pi-git — git & GitHub tools for pi.
 *
 * Behavior-level port of oh-my-pi (https://github.com/can1357/oh-my-pi)
 * © 2025-2026 Can Bölük (MIT), itself a fork of pi-mono © Mario Zechner (MIT).
 */

export interface ImageMetadata {
	mimeType: string;
	width?: number;
	height?: number;
}

/** Sniff an image's MIME type and dimensions from its leading bytes. */
export function parseImageMetadata(bytes: Uint8Array): ImageMetadata | null {
	if (bytes.length < 12) return null;

	// PNG: 89 50 4E 47 ... IHDR at offset 16.
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return {
			mimeType: "image/png",
			width: bytes[16]! * 2 ** 24 + bytes[17]! * 2 ** 16 + bytes[18]! * 2 ** 8 + bytes[19]!,
			height: bytes[20]! * 2 ** 24 + bytes[21]! * 2 ** 16 + bytes[22]! * 2 ** 8 + bytes[23]!,
		};
	}

	// GIF: "GIF8" then dimensions at offset 6 (little endian).
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return {
			mimeType: "image/gif",
			width: bytes[6]! + bytes[7]! * 256,
			height: bytes[8]! + bytes[9]! * 256,
		};
	}

	// WebP: "RIFF" .... "WEBP".
	if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
		return { mimeType: "image/webp" };
	}

	// JPEG: FF D8 FF ...; scan for a SOF marker with dimensions.
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) {
				offset += 1;
				continue;
			}
			const marker = bytes[offset + 1]!;
			const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
			if (isSof && offset + 9 <= bytes.length) {
				return {
					mimeType: "image/jpeg",
					height: bytes[offset + 5]! * 256 + bytes[offset + 6]!,
					width: bytes[offset + 7]! * 256 + bytes[offset + 8]!,
				};
			}
			offset += 2 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
		}
		return { mimeType: "image/jpeg" };
	}

	return null;
}
