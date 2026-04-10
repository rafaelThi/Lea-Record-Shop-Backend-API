import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const existing = await this.customerRepository.findOne({
      where: [{ document: dto.document }, { email: dto.email }],
    });

    if (existing) {
      throw new ConflictException(
        'A customer with this document or email already exists',
      );
    }

    const customer = this.customerRepository.create(dto);
    return this.customerRepository.save(customer);
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer with id ${id} not found`);
    }
    return customer;
  }

  async findActiveOrFail(id: string): Promise<Customer> {
    const customer = await this.findOne(id);
    if (!customer.active) {
      throw new BadRequestException(
        'Customer is inactive and cannot place orders',
      );
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);
    Object.assign(customer, dto);
    return this.customerRepository.save(customer);
  }

  async inactivate(id: string): Promise<Customer> {
    const customer = await this.findOne(id);
    customer.active = false;
    return this.customerRepository.save(customer);
  }

  async activate(id: string): Promise<Customer> {
    const customer = await this.findOne(id);
    customer.active = true;
    return this.customerRepository.save(customer);
  }
}
