/**
 * ADAPTERS LAYER — File-attachment storage.
 *
 * Marcos's brief: operators must be able to attach photos, PDFs, videos and
 * (later) audio notes to outbound messages. We store binaries on disk
 * under UPLOADS_DIR — a year/month/uuid layout keeps any single directory
 * from growing unbounded — and persist URL/mime/size on the Message row.
 *
 * Deliberately filesystem-backed (not S3) for this iteration:
 *   - Marcos hasn't provided cloud storage credentials yet;
 *   - the same code maps cleanly to S3 the moment he does (swap the
 *     `write/read` calls for an S3 client).
 *
 * Tunable in `.env`:
 *   UPLOADS_DIR                  — root directory (default /home/servifibras/uploads)
 *   UPLOADS_MAX_FILE_SIZE_MB     — per-file ceiling (default 25)
 *   UPLOADS_ALLOWED_MIME_TYPES   — comma-separated allow-list. Default
 *                                  covers WhatsApp's media set: jpeg/png/
 *                                  webp images, PDF, mp4/quicktime video,
 *                                  ogg/mp4 audio for the future audio step.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ContentType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DEFAULT_DIR = '/home/servifibras/uploads';
const DEFAULT_MAX_MB = 25;
const DEFAULT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
];

function uploadsRoot(): string {
  const raw = process.env.UPLOADS_DIR;
  return raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_DIR;
}

function maxBytes(): number {
  const raw = process.env.UPLOADS_MAX_FILE_SIZE_MB;
  const mb = raw != null ? Number(raw) : DEFAULT_MAX_MB;
  const safe = Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB;
  return safe * 1024 * 1024;
}

function allowedMimes(): Set<string> {
  const raw = process.env.UPLOADS_ALLOWED_MIME_TYPES;
  if (raw && raw.trim().length > 0) {
    return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  }
  return new Set(DEFAULT_MIME_TYPES);
}

export interface StoredFile {
  /** Operator-facing relative URL ("/admin/uploads/2026/05/abcdef.jpg"). */
  url: string;
  /** Original filename submitted by the operator. */
  name: string;
  /** MIME type as detected by the upload middleware. */
  mime: string;
  /** Size in bytes. */
  size: number;
  /** Inferred ContentType for the Message row. */
  contentType: ContentType;
}

export class FileTooLargeError extends Error {}
export class DisallowedMimeError extends Error {}

@Injectable()
export class UploadStorageService {
  private readonly logger = new Logger(UploadStorageService.name);

  /**
   * Persist an uploaded file under UPLOADS_DIR/yyyy/mm/uuid.ext and return
   * the metadata we need to attach to the Message. Throws on size/MIME
   * violations so the caller can return 4xx.
   */
  async store(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<StoredFile> {
    if (file.size <= 0) {
      throw new FileTooLargeError('empty upload');
    }
    if (file.size > maxBytes()) {
      throw new FileTooLargeError(
        `file ${file.size} bytes exceeds limit ${maxBytes()}`,
      );
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!allowedMimes().has(mime)) {
      throw new DisallowedMimeError(`MIME ${mime} not in allow-list`);
    }

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dir = path.join(uploadsRoot(), yyyy, mm);
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(file.originalname).toLowerCase().slice(0, 16) || extFromMime(mime);
    const id = crypto.randomBytes(12).toString('hex');
    const filename = `${id}${ext}`;
    const fullPath = path.join(dir, filename);

    fs.writeFileSync(fullPath, file.buffer, { mode: 0o640 });

    const relative = path.relative(uploadsRoot(), fullPath).split(path.sep).join('/');
    return {
      url: `/admin/uploads/${relative}`,
      name: file.originalname,
      mime,
      size: file.size,
      contentType: contentTypeFromMime(mime),
    };
  }

  /**
   * Resolve a relative key (`yyyy/mm/uuid.ext`) back to the absolute path
   * on disk, after validating it doesn't escape UPLOADS_DIR. Returns null
   * if the path is malformed or the file is missing.
   */
  resolveSafe(relativeKey: string): { absolute: string; mime: string } | null {
    if (!relativeKey || relativeKey.includes('..') || path.isAbsolute(relativeKey)) {
      return null;
    }
    const root = uploadsRoot();
    const absolute = path.join(root, relativeKey);
    // Defence-in-depth: ensure resolved path is still inside the root.
    const normalizedRoot = path.resolve(root) + path.sep;
    const resolved = path.resolve(absolute);
    if (!resolved.startsWith(normalizedRoot)) {
      return null;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }
    return { absolute: resolved, mime: mimeFromExt(path.extname(resolved)) };
  }
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png':  '.png',
    'image/webp': '.webp',
    'image/gif':  '.gif',
    'application/pdf': '.pdf',
    'video/mp4':       '.mp4',
    'video/quicktime': '.mov',
    'video/webm':      '.webm',
    'audio/ogg':       '.ogg',
    'audio/mpeg':      '.mp3',
    'audio/mp4':       '.m4a',
    'audio/webm':      '.webm',
  };
  return map[mime] ?? '.bin';
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.webp': 'image/webp',
    '.gif': 'image/gif',  '.pdf':  'application/pdf',
    '.mp4': 'video/mp4',  '.mov':  'video/quicktime',
    '.webm': 'video/webm',
    '.ogg': 'audio/ogg',  '.mp3':  'audio/mpeg', '.m4a': 'audio/mp4',
  };
  return map[e] ?? 'application/octet-stream';
}

function contentTypeFromMime(mime: string): ContentType {
  if (mime.startsWith('image/')) return ContentType.IMAGE;
  if (mime.startsWith('video/')) return ContentType.VIDEO;
  if (mime.startsWith('audio/')) return ContentType.VOICE;
  return ContentType.DOCUMENT;
}
