// Application I/O allowance for complete checkpoints plus their residual request.
// Working memory retains World's 1 MiB default; limits do not preallocate arenas.
export const parserKernelLimits = Object.freeze({ input: 4 << 20, working: 1 << 20, output: 4 << 20 });
export async function createParserKernel(Kernel, options) {
  const kernel = await Kernel.create(options);
  kernel.setLimits(parserKernelLimits);
  return kernel;
}
