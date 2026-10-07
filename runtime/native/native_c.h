/* Build-time translation only; never read by the deployed executable. */
#include <sqlite3.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>

/* Keep libc's target-specific stat layout on the C side. */
struct agent_native_stat {
    uint64_t st_dev;
    uint64_t st_ino;
    uint64_t st_uid;
    uint64_t st_nlink;
    uint32_t st_mode;
    int64_t st_size;
};
int agent_native_fstat(int fd, struct agent_native_stat *out);
typedef void (*agent_native_signal_handler)(int);
int agent_native_signals_begin(agent_native_signal_handler handler);
void agent_native_signals_end(void);

/* Private initialized-once hash state, borrowed only during synchronous calls.
   The optimized implementation checks these storage bounds at compilation. */
#define AGENT_NATIVE_SHA256_BYTES 256
#define AGENT_NATIVE_SHA256_ALIGNMENT 16
void agent_native_sha256_init(void *storage);
void agent_native_sha256_update(void *storage, const unsigned char *bytes, size_t length);
void agent_native_sha256_final(void *storage, unsigned char output[32]);
