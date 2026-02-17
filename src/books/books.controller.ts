import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { BooksService } from './books.service';

@Controller('books')
@UseGuards(JwtAuthGuard)
export class BooksController {
    constructor(private readonly books: BooksService) { }

    @Post()
    create(@Body() dto: any, @Request() req: any) {
        return this.books.create(req.user.userId, dto);
    }

    @Get()
    findAll(@Request() req: any) {
        return this.books.findAll(req.user.userId);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req: any) {
        return this.books.findOne(req.user.userId, +id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
        return this.books.update(req.user.userId, +id, dto);
    }

    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any) {
        return this.books.remove(req.user.userId, +id);
    }
}
