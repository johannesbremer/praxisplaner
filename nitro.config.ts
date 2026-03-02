function ignoreNodeModulesUseClientWarnings(
  warning: { code?: string; id?: string; message?: string },
  warn: (warning: unknown) => void,
) {
  const isUseClientDirectiveWarning =
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    warning.id?.includes("node_modules") &&
    warning.message?.includes('"use client"');

  if (isUseClientDirectiveWarning) {
    return;
  }

  warn(warning);
}

export default {
  compatibilityDate: "2025-09-24",
  rolldownConfig: {
    onwarn: ignoreNodeModulesUseClientWarnings,
  },
  rollupConfig: {
    onwarn: ignoreNodeModulesUseClientWarnings,
  },
};
