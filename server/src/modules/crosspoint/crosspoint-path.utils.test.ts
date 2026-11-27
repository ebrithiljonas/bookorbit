import { BadRequestException } from '@nestjs/common';

import { crosspointHttpUrl, normalizeCrosspointFileNamingPattern, normalizeCrosspointRootFolder } from './crosspoint-path.utils';

describe('CrossPoint path utilities', () => {
  describe('root folder', () => {
    it('keeps a normal managed folder and trims duplicate separators', () => {
      expect(normalizeCrosspointRootFolder('/BookOrbit')).toBe('/BookOrbit');
      expect(normalizeCrosspointRootFolder('  /My Books/  ')).toBe('/My Books');
      expect(normalizeCrosspointRootFolder('//BookOrbit//Reader//')).toBe('/BookOrbit/Reader');
      expect(normalizeCrosspointRootFolder('/')).toBe('/');
    });

    it('sanitizes characters the SD card cannot store', () => {
      expect(normalizeCrosspointRootFolder('/My:Books?')).toBe('/My_Books_');
    });

    it('refuses relative paths, traversal, empty values and oversized paths', () => {
      expect(() => normalizeCrosspointRootFolder('BookOrbit')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointRootFolder('/../etc')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointRootFolder('/a/./b')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointRootFolder('   ')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointRootFolder(`/${'a'.repeat(600)}`)).toThrow(BadRequestException);
    });
  });

  describe('file naming pattern', () => {
    it('accepts the default and optional blocks', () => {
      expect(normalizeCrosspointFileNamingPattern('<{authors:first} - >{title}')).toBe('<{authors:first} - >{title}');
      expect(normalizeCrosspointFileNamingPattern('{authors}/{series}/{title}')).toBe('{authors}/{series}/{title}');
    });

    it('refuses absolute patterns, traversal and unsupported characters', () => {
      expect(() => normalizeCrosspointFileNamingPattern('/{title}')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointFileNamingPattern('../{title}')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointFileNamingPattern('{title}?')).toThrow(BadRequestException);
      expect(() => normalizeCrosspointFileNamingPattern('   ')).toThrow(BadRequestException);
    });
  });

  describe('HTTP URL', () => {
    it('builds an IPv4 or hostname URL', () => {
      expect(crosspointHttpUrl('192.168.1.50', 80)).toBe('http://192.168.1.50:80');
      expect(crosspointHttpUrl('crosspoint.local', 8080)).toBe('http://crosspoint.local:8080');
    });

    it('brackets bare IPv6 addresses', () => {
      expect(crosspointHttpUrl('::1', 80)).toBe('http://[::1]:80');
      expect(crosspointHttpUrl('[::1]', 80)).toBe('http://[::1]:80');
    });
  });
});
