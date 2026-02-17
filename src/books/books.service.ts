import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BooksService {
    constructor(private readonly prisma: PrismaService) { }

    create(userId: number, dto: any) {
        return this.prisma.book.create({ data: { ...dto, userId } });
    }

    findAll(userId: number) {
        return this.prisma.book.findMany({ where: { userId } });
    }

    async findOne(userId: number, id: number) {
        const book = await this.prisma.book.findFirst({ where: { id, userId } });
        if (!book) throw new NotFoundException('Book not found');
        return book;
    }

    async update(userId: number, id: number, dto: any) {
        const updated = await this.prisma.book.updateMany({ where: { id, userId }, data: dto });
        if (!updated.count) throw new NotFoundException('Book not found');
        return this.prisma.book.findUnique({ where: { id } });
    }

    async remove(userId: number, id: number) {
        const deleted = await this.prisma.book.deleteMany({ where: { id, userId } });
        if (!deleted.count) throw new NotFoundException('Book not found');
        return { deleted: true };
    }
}
