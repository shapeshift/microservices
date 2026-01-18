import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { QuotesService, CreateQuoteDto, QuoteResponse } from './quotes.service';

/**
 * QuotesController handles HTTP endpoints for quote generation and retrieval.
 *
 * Endpoints:
 * - POST /quotes: Create a new quote for a send-swap operation
 * - GET /quotes/:id: Get a quote by its unique identifier
 */
@Controller('quotes')
export class QuotesController {
  constructor(private quotesService: QuotesService) {}

  /**
   * Create a new quote for a send-swap operation.
   *
   * @param data - Quote creation parameters including assets, amounts, and addresses
   * @returns The created quote with deposit address, expiration, and QR data
   */
  @Post()
  async createQuote(@Body() data: CreateQuoteDto): Promise<QuoteResponse> {
    return this.quotesService.createQuote(data);
  }

  /**
   * Get a quote by its unique identifier.
   *
   * @param id - The quote ID (e.g., "quote_abc123")
   * @returns The quote with current status and details
   */
  @Get(':id')
  async getQuote(@Param('id') id: string): Promise<QuoteResponse> {
    return this.quotesService.getQuote(id);
  }
}
