const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const ASSET_TYPES = Object.freeze({
    GALLERY: 'gallery',
    PRINCIPAL: 'principal',
    LOGO: 'logo',
    COMPROBANTE: 'comprobante'
});

const IMAGE_UPLOAD_PRESETS = Object.freeze({
    [ASSET_TYPES.GALLERY]: {
        folder: 'rifaplus/sorteos',
        maxWidth: 2200,
        maxHeight: 2200,
        quality: 80,
        format: 'webp'
    },
    [ASSET_TYPES.PRINCIPAL]: {
        folder: 'rifaplus/sorteos',
        maxWidth: 2200,
        maxHeight: 2200,
        quality: 80,
        format: 'webp'
    },
    [ASSET_TYPES.LOGO]: {
        folder: 'rifaplus/sorteos',
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 90,
        format: 'webp'
    },
    [ASSET_TYPES.COMPROBANTE]: {
        folder: 'rifas-comprobantes',
        maxWidth: 1800,
        maxHeight: 2200,
        quality: 80,
        format: 'webp'
    }
});

function normalizarAssetType(valor) {
    const assetType = String(valor || '').trim().toLowerCase();
    if (Object.values(ASSET_TYPES).includes(assetType)) {
        return assetType;
    }
    return ASSET_TYPES.GALLERY;
}

function sanitizarNombreBase(nombreArchivo = '') {
    return String(path.parse(nombreArchivo).name || 'archivo')
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
        || 'archivo';
}

function esMimeVectorial(mimetype = '') {
    return String(mimetype || '').toLowerCase() === 'image/svg+xml';
}

function esMimePdf(mimetype = '') {
    return String(mimetype || '').toLowerCase() === 'application/pdf';
}

function esMimeHeic(mimetype = '', originalName = '') {
    const mime = String(mimetype || '').toLowerCase();
    const ext = String(originalName || '').split('.').pop().toLowerCase();
    return mime.includes('heic') || mime.includes('heif') || ext === 'heic' || ext === 'heif';
}

function construirKeyR2({ assetType, originalName, formatOverride }) {
    const assetTypeNormalizado = normalizarAssetType(assetType);
    const preset = IMAGE_UPLOAD_PRESETS[assetTypeNormalizado];
    const nombreBase = sanitizarNombreBase(originalName);
    const sufijo = crypto.randomBytes(6).toString('hex');
    const ext = formatOverride ? `.${formatOverride}` : (path.parse(originalName || '').ext || '.webp');
    return `${preset.folder}/${assetTypeNormalizado}-${Date.now()}-${nombreBase}-${sufijo}${ext}`;
}

// Opciones de compatibilidad legacy
function construirOpcionesUpload({ assetType, originalName, mimetype }) {
    const assetTypeNormalizado = normalizarAssetType(assetType);
    const preset = IMAGE_UPLOAD_PRESETS[assetTypeNormalizado];
    return {
        folder: preset.folder,
        resource_type: esMimePdf(mimetype) ? 'raw' : 'image',
        public_id: construirKeyR2({ assetType: assetTypeNormalizado, originalName }),
        overwrite: true,
        secure: true
    };
}

let s3ClientInstance = null;
function getS3Client() {
    if (s3ClientInstance) return s3ClientInstance;

    const accountId = process.env.R2_ACCOUNT_ID || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

    if (!accountId || accountId === 'demo_account_id') {
        return null;
    }

    s3ClientInstance = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey
        }
    });

    return s3ClientInstance;
}

async function procesarImagenConSharp({ buffer, assetType, mimetype, originalName }) {
    if (esMimePdf(mimetype) || esMimeVectorial(mimetype)) {
        return { buffer, width: 0, height: 0, format: esMimePdf(mimetype) ? 'pdf' : 'svg', bytes: buffer.length };
    }

    if (esMimeHeic(mimetype, originalName)) {
        return { buffer, width: 0, height: 0, format: 'heic', bytes: buffer.length };
    }

    const assetTypeNormalizado = normalizarAssetType(assetType);
    const preset = IMAGE_UPLOAD_PRESETS[assetTypeNormalizado];

    let imagePipeline = sharp(buffer);
    const metadata = await imagePipeline.metadata();

    // Redimensionar si excede dimensiones máximas
    if ((metadata.width && metadata.width > preset.maxWidth) || (metadata.height && metadata.height > preset.maxHeight)) {
        imagePipeline = imagePipeline.resize({
            width: preset.maxWidth,
            height: preset.maxHeight,
            fit: 'inside',
            withoutEnlargement: true
        });
    }

    // Convertir a WebP
    const outputBuffer = await imagePipeline
        .webp({ quality: preset.quality })
        .toBuffer();

    const newMetadata = await sharp(outputBuffer).metadata();

    return {
        buffer: outputBuffer,
        width: newMetadata.width || metadata.width || 0,
        height: newMetadata.height || metadata.height || 0,
        format: 'webp',
        bytes: outputBuffer.length
    };
}

async function subirBufferAR2({ buffer, originalName, mimetype, assetType }) {
    const assetTypeNormalizado = normalizarAssetType(assetType);
    const s3 = getS3Client();

    // Procesar/Optimizar imagen localmente
    const procesado = await procesarImagenConSharp({ buffer, assetType: assetTypeNormalizado, mimetype, originalName });
    const key = construirKeyR2({ assetType: assetTypeNormalizado, originalName, formatOverride: procesado.format });

    const bucketName = process.env.R2_BUCKET_NAME || 'rifas-storage';
    const publicBaseUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

    // Si estamos en modo demo o sin R2 configurado, simulamos el upload de manera segura
    if (!s3 || publicBaseUrl.includes('pub-abcdef')) {
        console.warn('⚠️ [R2UploadService] Credenciales de R2 no configuradas o en modo demo. Usando mock url / buffer base64...');
        const base64Data = `data:${mimetype || 'image/' + procesado.format};base64,${procesado.buffer.toString('base64')}`;
        return {
            secureUrl: base64Data,
            publicId: key,
            bytes: procesado.bytes,
            width: procesado.width,
            height: procesado.height,
            format: procesado.format,
            resourceType: esMimePdf(mimetype) ? 'raw' : 'image'
        };
    }

    try {
        const contentType = esMimePdf(mimetype) ? 'application/pdf' : 
                            esMimeVectorial(mimetype) ? 'image/svg+xml' : 
                            esMimeHeic(mimetype, originalName) ? 'image/heic' : `image/${procesado.format}`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: procesado.buffer,
            ContentType: contentType
        });

        await s3.send(command);

        const secureUrl = `${publicBaseUrl}/${key}`;

        return {
            secureUrl,
            publicId: key,
            bytes: procesado.bytes,
            width: procesado.width,
            height: procesado.height,
            format: procesado.format,
            resourceType: esMimePdf(mimetype) ? 'raw' : 'image'
        };
    } catch (error) {
        console.error('❌ [R2UploadService] Error subiendo a R2:', error);
        throw new Error(`R2 upload error: ${error.message}`);
    }
}

module.exports = {
    ASSET_TYPES,
    IMAGE_UPLOAD_PRESETS,
    normalizarAssetType,
    construirOpcionesUpload,
    subirBufferAR2,
    subirBufferACloudinary: subirBufferAR2 // Adaptador transparente para código legacy
};
