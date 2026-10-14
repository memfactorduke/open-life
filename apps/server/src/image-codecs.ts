import sharp from 'sharp';

// Magic-byte checks enforce the upload contract. The native allowlist also prevents
// other callers from reaching bundled decoders through format auto-detection.
// Configure once at this shared module boundary; never loosen it per request.
// https://sharp.pixelplumbing.com/api-utility/#unblock
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'] });

export default sharp;
