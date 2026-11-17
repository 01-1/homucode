// GT validates every locale with Intl.Locale and English Intl.DisplayNames, which Hermes lacks.
// gt-react-native's Babel plugin would inject these; plain imports keep the Metro and Babel config unchanged.
import "@formatjs/intl-getcanonicallocales/polyfill";
import "@formatjs/intl-locale/polyfill";
// polyfill-force skips a support check that matches "en" against every locale: about 1s at launch.
import "@formatjs/intl-displaynames/polyfill-force";
import "@formatjs/intl-displaynames/locale-data/en";
