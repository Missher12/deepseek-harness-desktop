// Electron 43 V8 headers need both attribute placement and source_location.
// Keep the probe ahead of the full build so an incompatible compiler fails early.
#include <source_location>
class [[deprecated("compiler probe")]] __attribute__((visibility("default"))) Value {};
static_assert(std::source_location::current().line() > 0);
int main() { return 0; }
