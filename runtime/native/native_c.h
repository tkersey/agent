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
