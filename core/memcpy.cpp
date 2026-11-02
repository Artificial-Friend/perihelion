// memcpy / memset for the freestanding WebAssembly build (no libc).
#include <stddef.h>
extern "C" void* memcpy(void* d, const void* s, size_t n) { char* a = (char*)d; const char* b = (const char*)s; while (n--) *a++ = *b++; return d; }
extern "C" void* memset(void* d, int c, size_t n) { char* a = (char*)d; while (n--) *a++ = (char)c; return d; }
