// React Native CLI autolinking config for bare React Native projects.
//
// When the host project uses Expo autolinking (expo-modules-core is installed), the module is
// linked through expo-module.config.json instead. Disabling CLI autolinking in that case avoids
// the same Android classes being linked twice.
function hasExpoModulesCore() {
  try {
    require.resolve('expo-modules-core/package.json', { paths: [process.cwd(), __dirname] });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  dependency: {
    platforms: hasExpoModulesCore()
      ? { ios: null, android: null }
      : {
          android: {
            packageImportPath: 'import io.bugwatch.reactnative.BugwatchNativePackage;',
            packageInstance: 'new BugwatchNativePackage()',
          },
        },
  },
};
