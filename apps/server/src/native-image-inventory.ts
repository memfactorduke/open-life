import sharp from './image-codecs.js';

function atLeast(actual: string | undefined, patched: string) {
  if (!actual || !/^\d+\.\d+\.\d+$/.test(actual)) return null;
  const current = actual.split('.').map(Number);
  const minimum = patched.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (current[index] !== minimum[index]) return current[index]! > minimum[index]!;
  }
  return true;
}

/** Supplement package-manager SBOMs with the versions in the linked native bundle. */
export function nativeImageInventory() {
  const versions = { ...sharp.versions };
  const heifAdvisories = [
    'GHSA-h4h8-qgvc-m7r2',
    'GHSA-q7mw-2fmm-5q94',
    'GHSA-6fqc-p7r8-2g36',
    'GHSA-fcmw-5764-7rq8',
  ];
  const assessments = heifAdvisories.map((id) => ({
    id,
    component: 'heif',
    installedVersion: versions.heif ?? null,
    patchedVersion: '1.23.6',
    status: atLeast(versions.heif, '1.23.6') ? 'fixed' : 'not_affected',
    justification: 'vulnerable_code_not_in_execute_path',
    rationale:
      'All native input loaders are blocked except JPEG-buffer and PNG-buffer. HEIF decoding and HEIF YUV conversion cannot be reached by application input.',
    source: `https://github.com/strukturag/libheif/security/advisories/${id}`,
  }));
  const pngFixed = atLeast(versions.png, '1.6.59');
  assessments.push({
    id: 'CVE-2026-46675',
    component: 'png',
    installedVersion: versions.png ?? null,
    patchedVersion: '1.6.59',
    status: pngFixed
      ? 'fixed'
      : versions.vips === '8.18.7'
        ? 'not_affected'
        : 'under_investigation',
    justification: versions.vips === '8.18.7' ? 'vulnerable_code_not_in_execute_path' : '',
    rationale:
      'Reviewed libvips 8.18.7 foreign/vipspng.c never calls png_read_end, which this advisory requires. Re-review this conclusion whenever the linked libvips version changes.',
    source: 'https://github.com/pnggroup/libpng/security/advisories/GHSA-qvg3-h654-xq3j',
  });
  return {
    schemaVersion: 1,
    versions,
    decoderPolicy: {
      blocked: ['VipsForeignLoad'],
      allowed: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'],
      scope: 'process-wide native image input; output encoders are unchanged',
      source: 'https://sharp.pixelplumbing.com/api-utility/#unblock',
    },
    assessments,
    coverage:
      'Exact linked native versions supplement package-manager scans; these scoped assessments do not establish that every bundled native component is vulnerability-free.',
    reviewedDecoderSource:
      'https://github.com/libvips/libvips/blob/v8.18.7/libvips/foreign/vipspng.c',
  };
}
