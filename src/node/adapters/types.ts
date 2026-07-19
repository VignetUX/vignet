// A FrameworkAdapter contributes extra setup files for a consumer whose test-environment
// bootstrapping can't be expressed as "here's a list of files to import" (Tier 1's generic
// fix). Angular's TestBed.initTestEnvironment() is the motivating case: Angular CLI normally
// generates this as an in-memory virtual module templated by the Architect builder, which
// vignet has no lightweight way to invoke. Adapters instead contribute a small, vignet-owned
// setup file that calls the same public API directly.
export interface FrameworkAdapter {
  name: string
  detect(cwd: string): Promise<boolean>
  resolve(cwd: string): Promise<{ setupFiles: string[] }>
}
