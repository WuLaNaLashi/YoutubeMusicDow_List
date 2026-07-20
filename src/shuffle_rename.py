#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
红米蓝牙音箱2 本地模式随机播放辅助脚本
原理：在文件名头部添加随机前缀，让音箱按文件名排序时实现"伪随机"播放效果

用法：
    python3 shuffle_rename.py <音乐文件夹路径> [选项]

选项：
    --prefix-type {number,letter,mixed}  前缀类型：纯数字/纯字母/混合 (默认: mixed)
    --prefix-length N                    前缀长度 (默认: 4)
    --dry-run                            仅预览，不实际重命名
    --restore                            移除已有的随机前缀，恢复原始文件名
    --recursive                          递归处理子文件夹

示例：
    python3 shuffle_rename.py /media/sdcard/Music
    python3 shuffle_rename.py /media/sdcard/Music --prefix-type number --prefix-length 6
    python3 shuffle_rename.py /media/sdcard/Music --dry-run
    python3 shuffle_rename.py /media/sdcard/Music --restore
"""

import os
import sys
import random
import string
import re
import argparse
from pathlib import Path


def generate_prefix(prefix_type, length):
    """生成随机前缀"""
    if prefix_type == "number":
        return ''.join(random.choices(string.digits, k=length))
    elif prefix_type == "letter":
        return ''.join(random.choices(string.ascii_lowercase, k=length))
    else:  # mixed
        chars = string.ascii_lowercase + string.digits
        return ''.join(random.choices(chars, k=length))


def has_random_prefix(filename, prefix_type, length):
    """检查文件名是否已有随机前缀"""
    # 匹配类似 "a3b7_" 或 "1234_" 或 "abcd_" 开头的前缀
    pattern = r'^[a-z0-9]{' + str(length) + r'}_'
    return bool(re.match(pattern, filename))


def remove_prefix(filename, prefix_type, length):
    """移除随机前缀"""
    pattern = r'^[a-z0-9]{' + str(length) + r'}_(.+)'
    match = re.match(pattern, filename)
    if match:
        return match.group(1)
    return filename


def get_music_files(folder_path, recursive=False):
    """获取音乐文件列表"""
    music_exts = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'}

    files = []
    if recursive:
        for root, _, filenames in os.walk(folder_path):
            for f in filenames:
                if Path(f).suffix.lower() in music_exts:
                    files.append(os.path.join(root, f))
    else:
        for f in os.listdir(folder_path):
            filepath = os.path.join(folder_path, f)
            if os.path.isfile(filepath) and Path(f).suffix.lower() in music_exts:
                files.append(filepath)

    return sorted(files)


def shuffle_rename(folder_path, prefix_type="mixed", length=4, dry_run=False, recursive=False):
    """主功能：添加随机前缀"""
    folder_path = os.path.abspath(folder_path)

    if not os.path.isdir(folder_path):
        print(f"错误: 路径不存在或不是文件夹: {folder_path}")
        return False

    files = get_music_files(folder_path, recursive)

    if not files:
        print(f"未在 {folder_path} 中找到音乐文件")
        return False

    # 过滤掉已有前缀的文件（避免重复添加）
    files_to_rename = []
    for filepath in files:
        filename = os.path.basename(filepath)
        if not has_random_prefix(filename, prefix_type, length):
            files_to_rename.append(filepath)

    if not files_to_rename:
        print("所有文件已有随机前缀，无需处理。")
        print("如需重新随机，请先使用 --restore 恢复原始文件名。")
        return True

    print(f"找到 {len(files_to_rename)} 个待处理文件")
    print(f"前缀类型: {prefix_type}, 长度: {length}")
    if dry_run:
        print("【仅预览模式，不会实际重命名】")
    print("-" * 60)

    # 生成不重复的随机前缀
    used_prefixes = set()
    operations = []

    for filepath in files_to_rename:
        filename = os.path.basename(filepath)
        dirname = os.path.dirname(filepath)

        # 生成唯一前缀
        max_attempts = 1000
        for _ in range(max_attempts):
            prefix = generate_prefix(prefix_type, length)
            if prefix not in used_prefixes:
                used_prefixes.add(prefix)
                break
        else:
            print(f"警告: 无法为 {filename} 生成唯一前缀，尝试增加 --prefix-length")
            continue

        new_filename = f"{prefix}_{filename}"
        new_filepath = os.path.join(dirname, new_filename)

        operations.append((filepath, new_filepath, filename, new_filename))
        print(f"  {filename}")
        print(f"    -> {new_filename}")

    if dry_run:
        print("-" * 60)
        print("预览完成，未执行重命名。去掉 --dry-run 以实际执行。")
        return True

    # 执行重命名
    print("-" * 60)
    success_count = 0
    for old_path, new_path, old_name, new_name in operations:
        try:
            os.rename(old_path, new_path)
            success_count += 1
        except OSError as e:
            print(f"重命名失败: {old_name} -> {new_name}: {e}")

    print(f"完成！成功重命名 {success_count}/{len(operations)} 个文件")
    print(f"现在将文件夹复制到音箱SD卡，本地模式播放即可实现随机效果")
    return True


def restore_original(folder_path, prefix_type="mixed", length=4, recursive=False):
    """恢复原始文件名（移除随机前缀）"""
    folder_path = os.path.abspath(folder_path)

    if not os.path.isdir(folder_path):
        print(f"错误: 路径不存在或不是文件夹: {folder_path}")
        return False

    files = get_music_files(folder_path, recursive)

    operations = []
    for filepath in files:
        filename = os.path.basename(filepath)
        dirname = os.path.dirname(filepath)

        original = remove_prefix(filename, prefix_type, length)
        if original != filename:
            new_path = os.path.join(dirname, original)
            operations.append((filepath, new_path, filename, original))

    if not operations:
        print("未找到带有随机前缀的文件")
        return True

    print(f"找到 {len(operations)} 个带前缀的文件，准备恢复...")
    print("-" * 60)

    success_count = 0
    for old_path, new_path, old_name, new_name in operations:
        print(f"  {old_name}")
        print(f"    -> {new_name}")
        try:
            os.rename(old_path, new_path)
            success_count += 1
        except OSError as e:
            print(f"恢复失败: {old_name}: {e}")

    print(f"完成！成功恢复 {success_count}/{len(operations)} 个文件")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="红米蓝牙音箱2 本地模式随机播放辅助脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
说明：
  红米蓝牙音箱2的本地模式按文件名排序播放，无法随机。
  本脚本在文件名前添加随机前缀（如 a3b7_），让排序结果随机化，
  从而实现"伪随机"播放效果。

  建议配合 --dry-run 先预览，确认无误后再执行。
        """
    )
    parser.add_argument("folder", help="音乐文件夹路径")
    parser.add_argument(
        "--prefix-type", 
        choices=["number", "letter", "mixed"],
        default="mixed",
        help="随机前缀类型 (默认: mixed)"
    )
    parser.add_argument(
        "--prefix-length", 
        type=int, 
        default=4,
        help="前缀长度 (默认: 4)"
    )
    parser.add_argument(
        "--dry-run", 
        action="store_true",
        help="仅预览，不实际重命名"
    )
    parser.add_argument(
        "--restore", 
        action="store_true",
        help="移除随机前缀，恢复原始文件名"
    )
    parser.add_argument(
        "--recursive", 
        action="store_true",
        help="递归处理子文件夹"
    )

    args = parser.parse_args()

    if args.restore:
        restore_original(args.folder, args.prefix_type, args.prefix_length, args.recursive)
    else:
        shuffle_rename(args.folder, args.prefix_type, args.prefix_length, args.dry_run, args.recursive)


if __name__ == "__main__":
    main()
