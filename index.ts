import { registerRootComponent } from 'expo';

// Import the Tailwind/NativeWind stylesheet at the entry point. NativeWind v4
// transforms `global.css` into runtime style data via Metro's `withNativeWind`
// transformer, but the bundle only picks it up if SOMETHING imports the file.
// Without this import, every `className=...` resolves to no styles and screens
// render as unstyled <Text>/<View> trees.
import './global.css';

import { App } from './src/presentation/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native
// build, the environment is set up appropriately.
registerRootComponent(App);
