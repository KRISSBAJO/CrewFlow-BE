import { Injectable } from '@nestjs/common';

@Injectable()
export class TemplateService {
  render(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
      const value = data[key as string];
      if (value === undefined || value === null) {
        return '';
      }
      if (value instanceof Date) {
        return value.toLocaleString();
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ) {
        return value.toString();
      }
      return '';
    });
  }
}
