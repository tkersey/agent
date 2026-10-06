#include "native_c.h"

int agent_native_fstat(int fd, struct agent_native_stat *out) {
    struct stat value;
    if (fstat(fd, &value) != 0) return -1;
    out->st_dev = (uint64_t)value.st_dev;
    out->st_ino = (uint64_t)value.st_ino;
    out->st_uid = (uint64_t)value.st_uid;
    out->st_nlink = (uint64_t)value.st_nlink;
    out->st_mode = (uint32_t)value.st_mode;
    out->st_size = (int64_t)value.st_size;
    return 0;
}
