const shouldSkipHusky = process.env.CI === 'true' || process.env.NODE_ENV === 'production';

if (shouldSkipHusky) {
  console.log('Skipping Husky installation in CI/production.');
} else {
  try {
    const { default: husky } = await import('husky');
    husky();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('Husky is not installed; skipping Git hook setup.');
    } else {
      throw error;
    }
  }
}
