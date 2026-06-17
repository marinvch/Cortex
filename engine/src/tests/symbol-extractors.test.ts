import { describe, it, expect } from 'vitest';
import {
  TypeScriptExtractor,
  PythonExtractor,
  GoExtractor,
  JavaExtractor,
  RustExtractor,
  RubyExtractor,
  PhpExtractor,
  getExtractorForFile,
} from '../detectors/symbols.js';

// ── TypeScript extractor ───────────────────────────────────────────────────

describe('TypeScriptExtractor', () => {
  it('extracts exported functions', () => {
    const src = `export function foo(x: number): string { return String(x); }`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/foo.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'foo', kind: 'function' }));
  });

  it('extracts async functions', () => {
    const src = `export async function bar(): Promise<void> {}`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/bar.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'bar', kind: 'function' }));
  });

  it('extracts arrow function exports', () => {
    const src = `export const baz = (a: string) => a.trim();`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/baz.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'baz', kind: 'function' }));
  });

  it('extracts classes', () => {
    const src = `export class MyService {}`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/service.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'MyService', kind: 'class' }));
  });

  it('extracts interfaces', () => {
    const src = `export interface User { id: string; }`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/types.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'User', kind: 'interface' }));
  });

  it('extracts type aliases', () => {
    const src = `export type Status = 'active' | 'inactive';`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/types.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Status', kind: 'type' }));
  });

  it('extracts enums', () => {
    const src = `export enum Role { Admin, User }`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/roles.ts');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Role', kind: 'enum' }));
  });

  it('deduplicates repeated symbol names', () => {
    const src = `export function foo() {}\nexport function foo() {}`;
    const symbols = TypeScriptExtractor.extractSymbols(src, 'src/foo.ts');
    expect(symbols.filter(s => s.name === 'foo')).toHaveLength(1);
  });

  it('extracts JSDoc purpose', () => {
    const src = `/** Formats a date string for display. */\nexport function format() {}`;
    expect(TypeScriptExtractor.extractPurpose(src)).toBe('Formats a date string for display.');
  });

  it('extracts tags from path and content', () => {
    const tags = TypeScriptExtractor.extractTags('export function loginUser() {}', 'src/auth/login.ts');
    expect(tags).toContain('auth');
  });
});

// ── Python extractor ────────────────────────────────────────────────────────

describe('PythonExtractor', () => {
  it('extracts module-level functions', () => {
    const src = `def process_data(df):\n    pass\n`;
    const symbols = PythonExtractor.extractSymbols(src, 'utils.py');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'process_data', kind: 'function' }));
  });

  it('extracts classes', () => {
    const src = `class UserModel:\n    pass\n`;
    const symbols = PythonExtractor.extractSymbols(src, 'models.py');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'UserModel', kind: 'class' }));
  });

  it('does NOT extract indented methods as module symbols', () => {
    const src = `class Foo:\n    def bar(self):\n        pass\n`;
    const symbols = PythonExtractor.extractSymbols(src, 'foo.py');
    expect(symbols.find(s => s.name === 'bar')).toBeUndefined();
  });

  it('extracts docstring purpose', () => {
    const src = `"""Process CSV files for ingestion."""\ndef load():\n    pass`;
    expect(PythonExtractor.extractPurpose(src)).toBe('Process CSV files for ingestion.');
  });
});

// ── Go extractor ────────────────────────────────────────────────────────────

describe('GoExtractor', () => {
  it('extracts exported functions (uppercase)', () => {
    const src = `func ServeHTTP(w http.ResponseWriter, r *http.Request) {}`;
    const symbols = GoExtractor.extractSymbols(src, 'server.go');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'ServeHTTP', kind: 'function' }));
  });

  it('does NOT extract unexported functions', () => {
    const src = `func helper() {}`;
    const symbols = GoExtractor.extractSymbols(src, 'internal.go');
    expect(symbols.find(s => s.name === 'helper')).toBeUndefined();
  });

  it('extracts exported structs', () => {
    const src = `type UserStore struct { db *sql.DB }`;
    const symbols = GoExtractor.extractSymbols(src, 'store.go');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'UserStore', kind: 'type' }));
  });

  it('extracts exported interfaces', () => {
    const src = `type Repository interface { Find(id int) (*User, error) }`;
    const symbols = GoExtractor.extractSymbols(src, 'repo.go');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Repository', kind: 'interface' }));
  });

  it('extracts package doc purpose', () => {
    const src = `// Package auth provides JWT-based authentication.\npackage auth`;
    expect(GoExtractor.extractPurpose(src)).toBe('provides JWT-based authentication.');
  });
});

// ── Java extractor ───────────────────────────────────────────────────────────

describe('JavaExtractor', () => {
  it('extracts public classes', () => {
    const src = `public class PaymentService {}`;
    const symbols = JavaExtractor.extractSymbols(src, 'PaymentService.java');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'PaymentService', kind: 'class' }));
  });

  it('extracts public methods', () => {
    const src = `public class Foo {\n  public String getName() { return name; }\n}`;
    const symbols = JavaExtractor.extractSymbols(src, 'Foo.java');
    expect(symbols.some(s => s.name === 'getName' && s.kind === 'method')).toBe(true);
  });

  it('extracts interfaces', () => {
    const src = `public interface Runnable { void run(); }`;
    const symbols = JavaExtractor.extractSymbols(src, 'Runnable.java');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Runnable', kind: 'interface' }));
  });
});

// ── Rust extractor ───────────────────────────────────────────────────────────

describe('RustExtractor', () => {
  it('extracts pub fn', () => {
    const src = `pub fn parse_config(path: &str) -> Config {}`;
    const symbols = RustExtractor.extractSymbols(src, 'config.rs');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'parse_config', kind: 'function' }));
  });

  it('extracts pub struct', () => {
    const src = `pub struct AppState { pub db: Pool }`;
    const symbols = RustExtractor.extractSymbols(src, 'state.rs');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'AppState', kind: 'type' }));
  });

  it('extracts pub trait', () => {
    const src = `pub trait Handler { fn handle(&self); }`;
    const symbols = RustExtractor.extractSymbols(src, 'handler.rs');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Handler', kind: 'interface' }));
  });

  it('extracts pub enum', () => {
    const src = `pub enum Status { Active, Inactive }`;
    const symbols = RustExtractor.extractSymbols(src, 'status.rs');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Status', kind: 'enum' }));
  });

  it('extracts //! inner doc purpose', () => {
    const src = `//! Handles database connection pooling.\nuse sqlx::Pool;`;
    expect(RustExtractor.extractPurpose(src)).toBe('Handles database connection pooling.');
  });
});

// ── Ruby extractor ───────────────────────────────────────────────────────────

describe('RubyExtractor', () => {
  it('extracts module-level def', () => {
    const src = `def authenticate(token)\n  verify(token)\nend`;
    const symbols = RubyExtractor.extractSymbols(src, 'auth.rb');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'authenticate', kind: 'function' }));
  });

  it('extracts class', () => {
    const src = `class UserMailer < ActionMailer::Base\nend`;
    const symbols = RubyExtractor.extractSymbols(src, 'user_mailer.rb');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'UserMailer', kind: 'class' }));
  });

  it('extracts module', () => {
    const src = `module AuthHelper\nend`;
    const symbols = RubyExtractor.extractSymbols(src, 'auth_helper.rb');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'AuthHelper', kind: 'type' }));
  });
});

// ── PHP extractor ────────────────────────────────────────────────────────────

describe('PhpExtractor', () => {
  it('extracts global functions', () => {
    const src = `<?php\nfunction generateToken($length = 32): string {}`;
    const symbols = PhpExtractor.extractSymbols(src, 'helpers.php');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'generateToken', kind: 'function' }));
  });

  it('extracts classes', () => {
    const src = `class UserRepository {}`;
    const symbols = PhpExtractor.extractSymbols(src, 'UserRepository.php');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'UserRepository', kind: 'class' }));
  });

  it('extracts interfaces', () => {
    const src = `interface Cacheable { public function cache(): void; }`;
    const symbols = PhpExtractor.extractSymbols(src, 'Cacheable.php');
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'Cacheable', kind: 'interface' }));
  });
});

// ── getExtractorForFile registry ────────────────────────────────────────────

describe('getExtractorForFile', () => {
  it('returns TypeScript extractor for .ts files', () => {
    expect(getExtractorForFile('src/foo.ts')?.language).toBe('TypeScript');
  });
  it('returns TypeScript extractor for .tsx files', () => {
    expect(getExtractorForFile('src/App.tsx')?.language).toBe('TypeScript');
  });
  it('returns Python extractor for .py files', () => {
    expect(getExtractorForFile('scripts/run.py')?.language).toBe('Python');
  });
  it('returns Go extractor for .go files', () => {
    expect(getExtractorForFile('main.go')?.language).toBe('Go');
  });
  it('returns Rust extractor for .rs files', () => {
    expect(getExtractorForFile('src/lib.rs')?.language).toBe('Rust');
  });
  it('returns Ruby extractor for .rb files', () => {
    expect(getExtractorForFile('app/models/user.rb')?.language).toBe('Ruby');
  });
  it('returns PHP extractor for .php files', () => {
    expect(getExtractorForFile('app/Controllers/UserController.php')?.language).toBe('PHP');
  });
  it('returns null for unsupported extensions', () => {
    expect(getExtractorForFile('styles/main.css')).toBeNull();
  });
});
